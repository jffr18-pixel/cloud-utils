"""Interfaz grafica para la revision de expedientes de extranjeria.

Ejecutar con:
    streamlit run app.py
"""

import os
from datetime import date

import anthropic
import pandas as pd
import streamlit as st

from revision import analizador, informe, tramites

st.set_page_config(
    page_title="Revision de expedientes de extranjeria",
    page_icon="📁",
    layout="wide",
)

MODELOS = {
    "Claude Opus 4.8 (maxima precision)": "claude-opus-4-8",
    "Claude Sonnet 4.6 (equilibrado, mas economico)": "claude-sonnet-4-6",
    "Claude Haiku 4.5 (rapido y barato)": "claude-haiku-4-5",
}

_BADGE = {
    "correcto": ("✅", "Correcto"),
    "con_incidencias": ("⚠️", "Revisar"),
    "proximo_a_caducar": ("🟠", "Caduca pronto"),
    "caducado": ("⛔", "Caducado"),
    "falta": ("❌", "Falta"),
    "falta_opcional": ("➖", "Falta (opcional)"),
}


def obtener_cliente(api_key):
    return anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()


def main():
    st.title("📁 Revision de expedientes de extranjeria")
    st.caption(
        "Sube los documentos del expediente (PDF o fotos de WhatsApp) y la "
        "herramienta los lee, clasifica y comprueba que documentacion falta, "
        "esta caducada o tiene incidencias."
    )

    # ----------------------------- Barra lateral -----------------------------
    with st.sidebar:
        st.header("Configuracion")

        api_key_env = os.environ.get("ANTHROPIC_API_KEY")
        if api_key_env:
            st.success("Clave de API detectada en el entorno.")
            api_key = None
        else:
            api_key = st.text_input(
                "Clave de API de Anthropic",
                type="password",
                help="Se usa solo en esta sesion. Tambien puedes definir ANTHROPIC_API_KEY.",
            )

        nombre_modelo = st.selectbox("Modelo de IA", list(MODELOS.keys()))
        modelo = MODELOS[nombre_modelo]

        dias_aviso = st.number_input(
            "Avisar si caduca en menos de (dias)",
            min_value=0,
            max_value=365,
            value=analizador.DIAS_AVISO_CADUCIDAD,
            step=15,
        )

        st.divider()
        st.markdown(
            "**Como funciona**\n\n"
            "1. Elige el tramite.\n"
            "2. Sube los documentos.\n"
            "3. Pulsa *Analizar expediente*.\n"
            "4. Descarga el informe."
        )

    # ----------------------------- Datos del caso ----------------------------
    col1, col2 = st.columns(2)
    with col1:
        opciones = tramites.lista_tramites()
        etiquetas = [nombre for _, nombre in opciones]
        idx = st.selectbox(
            "Tipo de tramite", range(len(opciones)), format_func=lambda i: etiquetas[i]
        )
        tramite_id = opciones[idx][0]
    with col2:
        solicitante = st.text_input("Nombre del solicitante (opcional)")

    st.info(tramites.TRAMITES[tramite_id]["descripcion"])

    with st.expander("Ver documentacion exigida para este tramite"):
        for doc in tramites.documentos_de(tramite_id):
            marca = "**(obligatorio)**" if doc["obligatorio"] else "(opcional)"
            st.markdown(f"- {doc['nombre']} {marca} — {doc.get('notas', '')}")

    # ------------------------------- Subida ----------------------------------
    archivos = st.file_uploader(
        "Documentos del expediente (PDF, JPG, PNG)",
        type=analizador.extensiones_admitidas(),
        accept_multiple_files=True,
        help="Puedes subir varias fotos y PDF a la vez.",
    )

    # ---------------------- Agrupacion de paginas/fotos ----------------------
    grupos = None
    if archivos:
        st.markdown("##### Agrupar paginas de un mismo documento")
        st.caption(
            "Pon el **mismo numero de grupo** a las fotos que sean el mismo "
            "documento (p.ej. las 4 fotos de un pasaporte). Por defecto cada "
            "archivo se analiza por separado."
        )
        col_grupo = "Grupo (mismo nº = mismo documento)"
        df = pd.DataFrame(
            {
                "Archivo": [a.name for a in archivos],
                col_grupo: list(range(1, len(archivos) + 1)),
            }
        )
        editado = st.data_editor(
            df,
            disabled=["Archivo"],
            hide_index=True,
            use_container_width=True,
            column_config={
                col_grupo: st.column_config.NumberColumn(
                    min_value=1, step=1, format="%d"
                )
            },
            key="editor_grupos",
        )
        grupos = {}
        for i, archivo in enumerate(archivos):
            clave = int(editado.iloc[i][col_grupo])
            grupos.setdefault(clave, []).append((archivo.name, archivo.getvalue()))

    analizar = st.button("🔍 Analizar expediente", type="primary", disabled=not archivos)

    # -------------------------------- Analisis -------------------------------
    if analizar and archivos:
        try:
            cliente = obtener_cliente(api_key)
        except Exception as exc:  # noqa: BLE001
            st.error(f"No se pudo iniciar el cliente de IA: {exc}")
            st.stop()

        hoy = date.today()
        resultados = []
        items = [grupos[k] for k in sorted(grupos)]
        barra = st.progress(0.0, text="Analizando documentos...")
        for i, paginas in enumerate(items, start=1):
            nombres = ", ".join(n for n, _ in paginas)
            barra.progress(i / len(items), text=f"Analizando {nombres} ({i}/{len(items)})")
            try:
                datos = analizador.analizar_documento(
                    cliente,
                    paginas,
                    tramite_id,
                    modelo=modelo,
                    hoy=hoy,
                    dias_aviso=int(dias_aviso),
                )
            except Exception as exc:  # noqa: BLE001
                datos = {
                    "archivo": nombres,
                    "archivos": [n for n, _ in paginas],
                    "tipo_id": "no_identificado",
                    "tipo_nombre": "Error al analizar",
                    "estado": "desconocido",
                    "legibilidad": "-",
                    "incidencias": [f"No se pudo analizar: {exc}"],
                    "resumen": "",
                    "fecha_caducidad": None,
                }
            resultados.append(datos)
        barra.empty()

        # Guardar en sesion para no re-analizar al interactuar.
        st.session_state["resultados"] = resultados
        st.session_state["tramite_id"] = tramite_id
        st.session_state["solicitante"] = solicitante
        st.session_state["hoy"] = hoy

    # -------------------------------- Resultados -----------------------------
    if "resultados" in st.session_state:
        resultados = st.session_state["resultados"]
        tramite_id = st.session_state["tramite_id"]
        solicitante = st.session_state["solicitante"]
        hoy = st.session_state["hoy"]

        checklist, no_identificados = analizador.evaluar_expediente(resultados, tramite_id)
        listo = analizador.expediente_listo(checklist)

        st.divider()
        if listo:
            st.success("✅ Expediente completo: no faltan obligatorios ni hay caducados.")
        else:
            st.error("⛔ Expediente incompleto: revisa los documentos marcados abajo.")

        faltan = sum(1 for c in checklist if c["estado"] == "falta")
        caducados = sum(1 for c in checklist if c["estado"] == "caducado")
        avisos = sum(
            1 for c in checklist if c["estado"] in ("con_incidencias", "proximo_a_caducar")
        )
        m1, m2, m3 = st.columns(3)
        m1.metric("Obligatorios que faltan", faltan)
        m2.metric("Caducados", caducados)
        m3.metric("A revisar / caducan pronto", avisos)

        st.subheader("Checklist de documentacion")
        for fila in checklist:
            icono, etiqueta = _BADGE.get(fila["estado"], ("•", fila["estado"]))
            oblig = " · obligatorio" if fila["obligatorio"] else " · opcional"
            with st.expander(f"{icono} {fila['nombre']} — {etiqueta}{oblig}"):
                if fila["documentos"]:
                    for doc in fila["documentos"]:
                        _mostrar_documento(doc)
                else:
                    st.write(fila.get("notas", "No aportado."))

        if no_identificados:
            st.subheader("Documentos no identificados")
            st.caption("No encajan con ningun requisito del tramite. Revisar a mano.")
            for doc in no_identificados:
                _mostrar_documento(doc)

        texto_informe = informe.generar_informe(
            checklist, no_identificados, tramite_id, solicitante=solicitante, hoy=hoy
        )

        st.subheader("Informe de revision")
        st.markdown(texto_informe)

        nombre_base = (solicitante or "expediente").strip().replace(" ", "_").lower() or "expediente"
        fecha = hoy.isoformat()
        d1, d2, d3 = st.columns(3)
        with d1:
            st.download_button(
                "⬇️ Markdown (.md)",
                data=texto_informe,
                file_name=f"informe_{nombre_base}_{fecha}.md",
                mime="text/markdown",
                use_container_width=True,
            )
        with d2:
            try:
                docx_bytes = informe.generar_docx(
                    checklist, no_identificados, tramite_id, solicitante=solicitante, hoy=hoy
                )
                st.download_button(
                    "⬇️ Word (.docx)",
                    data=docx_bytes,
                    file_name=f"informe_{nombre_base}_{fecha}.docx",
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    use_container_width=True,
                )
            except Exception as exc:  # noqa: BLE001
                st.caption(f"Word no disponible: {exc}")
        with d3:
            try:
                pdf_bytes = informe.generar_pdf(
                    checklist, no_identificados, tramite_id, solicitante=solicitante, hoy=hoy
                )
                st.download_button(
                    "⬇️ PDF (.pdf)",
                    data=pdf_bytes,
                    file_name=f"informe_{nombre_base}_{fecha}.pdf",
                    mime="application/pdf",
                    use_container_width=True,
                )
            except Exception as exc:  # noqa: BLE001
                st.caption(f"PDF no disponible: {exc}")


def _mostrar_documento(doc):
    cols = st.columns([2, 1])
    with cols[0]:
        st.write(f"**Archivo:** {doc.get('archivo', '-')}")
        if doc.get("titular"):
            st.write(f"**Titular:** {doc['titular']}")
        if doc.get("numero"):
            st.write(f"**Numero:** {doc['numero']}")
        if doc.get("pais_emision"):
            st.write(f"**Pais/autoridad:** {doc['pais_emision']}")
        if doc.get("resumen"):
            st.caption(doc["resumen"])
    with cols[1]:
        if doc.get("fecha_emision"):
            st.write(f"**Emision:** {doc['fecha_emision']}")
        if doc.get("fecha_caducidad"):
            st.write(f"**Caducidad:** {doc['fecha_caducidad']}")
        st.write(f"**Estado:** {doc.get('estado', '-')}")
        st.write(f"**Legibilidad:** {doc.get('legibilidad', '-')}")
    if doc.get("incidencias"):
        for inc in doc["incidencias"]:
            st.warning(inc)


if __name__ == "__main__":
    main()
