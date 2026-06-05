import logging
import tempfile
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/124.0.0.0 Safari/537.36'
)


class DEHUSession:
    """HTTPS session authenticated with a PKCS12 digital certificate."""

    def __init__(self, cert_pfx_path: str, cert_password: str = '',
                 base_url: str = 'https://dehu.redsara.es', timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self._cert_pfx_path = cert_pfx_path.strip().strip('"\'')
        self._cert_password = cert_password.strip()
        self._session: Optional[requests.Session] = None
        self._tmp_cert: Optional[Path] = None
        self._tmp_key: Optional[Path] = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.close()

    def connect(self):
        self._session = requests.Session()
        self._session.headers['User-Agent'] = _USER_AGENT

        # Try requests-pkcs12 first (no temp files needed)
        try:
            from requests_pkcs12 import Pkcs12Adapter
            password = self._cert_password.encode() if self._cert_password else None
            adapter = Pkcs12Adapter(
                pkcs12_filename=self._cert_pfx_path,
                pkcs12_password=password,
            )
            self._session.mount('https://', adapter)
            logger.info("Sesión DEHU iniciada con requests-pkcs12.")
        except ImportError:
            # Fallback: extract PEM to temp files
            self._session.cert = self._extract_pem_files()
            logger.info("Sesión DEHU iniciada con PEM temporal.")

        self._session.verify = True

    def _extract_pem_files(self):
        from cryptography.hazmat.primitives.serialization import (
            Encoding, PrivateFormat, NoEncryption,
        )
        from cryptography.hazmat.primitives.serialization.pkcs12 import (
            load_key_and_certificates,
        )

        password = self._cert_password.encode() if self._cert_password else None
        pfx_data = Path(self._cert_pfx_path).read_bytes()
        private_key, certificate, _ = load_key_and_certificates(pfx_data, password)

        tmp = Path(tempfile.mkdtemp())
        self._tmp_cert = tmp / 'cert.pem'
        self._tmp_key = tmp / 'key.pem'
        self._tmp_cert.write_bytes(certificate.public_bytes(Encoding.PEM))
        self._tmp_key.write_bytes(
            private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        )
        return str(self._tmp_cert), str(self._tmp_key)

    def get(self, path: str, **kwargs) -> requests.Response:
        return self._session.get(self.base_url + path, timeout=self.timeout, **kwargs)

    def post(self, path: str, **kwargs) -> requests.Response:
        return self._session.post(self.base_url + path, timeout=self.timeout, **kwargs)

    def close(self):
        if self._session:
            self._session.close()
        for tmp in (self._tmp_cert, self._tmp_key):
            if tmp and tmp.exists():
                tmp.unlink(missing_ok=True)
        if self._tmp_cert:
            self._tmp_cert.parent.rmdir()
