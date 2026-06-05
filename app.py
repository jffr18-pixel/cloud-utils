"""Interfaz grafica para la revision de expedientes de extranjeria.

Ejecutar con:
    streamlit run app.py
"""

import os
import re
from datetime import date

import anthropic
import pandas as pd
import streamlit as st

from revision import analizador, config, historial, informe, tramites

st.set_page_config(
    page_title="Revision de expedientes de extranjeria",
    page_icon="📁",
    layout="wide",
)

# Cargar tramites personalizados (si los hay) una vez por sesion.
if "inicializado" not in st.session_state:
    config.inicializar()
    st.session_state["inicializado"] = True

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


def _slug(texto):
    texto = (texto or "").strip().lower()
    texto = re.sub(r"[áàä]", "a", texto)
    texto = re.sub(r"[éèë]", "e", texto)
    texto = re.sub(r"[íìï]", "i", texto)
    texto = re.sub(r"[óòö]", "o", texto)
    texto = re.sub(r"[úùü]", "u", texto)
    texto = texto.replace("ñ", "n")
    texto = re.sub(r"[^a-z0-9]+", "_", texto).strip("_")
    return texto or "tramite"


# --------------------------------------------------------------------------- #
#  Barra lateral (configuracion comun)
# --------------------------------------------------------------------------- #
def barra_lateral():
    with st.sidebar:
        st.title("📁 Extranjeria")
        pagina = st.radio(
            "Menu",
            ["Revisar expediente", "Historial", "Tramites", "Gestoria"],
            label_visibility="collapsed",
        )
        st.divider()

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
        st.caption(f"Datos guardados en: `{config.BASE_DIR}`")
    return pagina, api_key, modelo, int(dias_aviso)


# --------------------------------------------------------------------------- #
#  Pagina: Revisar expediente
# --------------------------------------------------------------------------- #
def pagina_revisar(api_key, modelo, dias_aviso):
    st.title("Revisar expediente")
    st.caption(
        "Sube los documentos (PDF o fotos de WhatsApp) y la herramienta los lee, "
        "clasifica y comprueba que documentacion falta, esta caducada o tiene incidencias."
    )

    if not tramites.lista_tramites():
        st.warning("No hay tramites definidos. Ve a la pestana 'Tramites' para crear uno.")
        return

    col1, col2 = st.columns(2)
    with col1:
        opciones = tramites.lista_tramites()
        etiquetas = [n for _, n in opciones]
        idx = st.selectbox(
            "Tipo de tramite", range(len(opciones)), format_func=lambda i: etiquetas[i]
        )
        tramite_id = opciones[idx][0]
    with col2:
        solicitante = st.text_input("Nombre del solicitante (opcional)")

    st.info(tramites.TRAMITES[tramite_id].get("descripcion", ""))
    with st.expander("Ver documentacion exigida para este tramite"):
        for doc in tramites.documentos_de(tramite_id):
            marca = "**(obligatorio)**" if doc["obligatorio"] else "(opcional)"
            st.markdown(f"- {doc['nombre']} {marca} — {doc.get('notas', '')}")

    archivos = st.file_uploader(
        "Documentos del expediente (PDF, JPG, PNG)",
        type=analizador.extensiones_admitidas(),
        accept_multiple_files=True,
        help="Puedes subir varias fotos y PDF a la vez.",
    )

    grupos = None
    if archivos:
        st.markdown("##### Agrupar paginas de un mismo documento")
        st.caption(
            "Pon el **mismo numero de grupo** a las fotos que sean el mismo documento "
            "(p.ej. las 4 fotos de un pasaporte). Por defecto cada archivo va por separado."
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
                col_grupo: st.column_config.NumberColumn(min_value=1, step=1, format="%d")
            },
            key="editor_grupos",
        )
        grupos = {}
        for i, archivo in enumerate(archivos):
            clave = int(editado.iloc[i][col_grupo])
            grupos.setdefault(clave, []).append((archivo.name, archivo.getvalue()))

    if st.button("🔍 Analizar expediente", type="primary", disabled=not archivos):
        try:
            cliente = obtener_cliente(api_key)
        except Exception as exc:  # noqa: BLE001
            st.error(f"No se pudo iniciar el cliente de IA: {exc}")
            return

        hoy = date.today()
        resultados = []
        items = [grupos[k] for k in sorted(grupos)]
        barra = st.progress(0.0, text="Analizando documentos...")
        for i, paginas in enumerate(items, start=1):
            nombres = ", ".join(n for n, _ in paginas)
            barra.progress(i / len(items), text=f"Analizando {nombres} ({i}/{len(items)})")
            try:
                datos = analizador.analizar_documento(
                    cliente, paginas, tramite_id, modelo=modelo, hoy=hoy, dias_aviso=dias_aviso
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

        try:
            historial.guardar(tramite_id, solicitante, resultados)
        except Exception:  # noqa: BLE001
            pass  # el historial es un extra; no debe bloquear el flujo

        st.session_state["resultados"] = resultados
        st.session_state["tramite_id"] = tramite_id
        st.session_state["solicitante"] = solicitante
        st.session_state["hoy"] = hoy

    if "resultados" in st.session_state:
        mostrar_resultados(
            st.session_state["resultados"],
            st.session_state["tramite_id"],
            st.session_state["solicitante"],
            st.session_state["hoy"],
        )


# --------------------------------------------------------------------------- #
#  Pagina: Historial
# --------------------------------------------------------------------------- #
def pagina_historial():
    st.title("Historial de expedientes")
    registros = historial.listar()
    if not registros:
        st.info("Aun no hay expedientes revisados. Revisa uno en la pestana correspondiente.")
        return

    nombres_tramite = {tid: t["nombre"] for tid, t in tramites.TRAMITES.items()}
    tabla = pd.DataFrame(
        [
            {
                "Fecha": r["fecha"].replace("T", " "),
                "Solicitante": r["solicitante"] or "-",
                "Tramite": nombres_tramite.get(r["tramite_id"], r["tramite_id"]),
                "Resultado": "✅ Listo" if r["listo"] else "⛔ Incompleto",
                "Faltan": r["faltan"],
                "Caducados": r["caducados"],
                "Avisos": r["avisos"],
                "id": r["id"],
            }
            for r in registros
        ]
    )
    st.dataframe(
        tabla.drop(columns=["id"]), hide_index=True, use_container_width=True
    )

    etiquetas = {
        r["id"]: f"{r['fecha'].replace('T', ' ')} · {r['solicitante'] or 'sin nombre'}"
        for r in registros
    }
    sel = st.selectbox(
        "Ver expediente", list(etiquetas), format_func=lambda i: etiquetas[i]
    )
    c1, c2 = st.columns([1, 1])
    abrir = c1.button("Abrir expediente", type="primary")
    if c2.button("🗑️ Eliminar del historial"):
        historial.eliminar(sel)
        st.success("Expediente eliminado del historial.")
        st.rerun()

    if abrir:
        registro = historial.cargar(sel)
        if not registro:
            st.error("No se pudo cargar el expediente.")
            return
        st.divider()
        mostrar_resultados(
            registro["resultados"],
            registro["tramite_id"],
            registro["solicitante"],
            date.fromisoformat(registro["fecha"][:10]),
            prefijo=f"hist_{sel}",
        )


# --------------------------------------------------------------------------- #
#  Pagina: Tramites (editor de checklists)
# --------------------------------------------------------------------------- #
def pagina_tramites():
    st.title("Tramites y documentacion")
    st.caption(
        "Edita la documentacion exigida por cada tramite. Los cambios se guardan "
        "y se usan en las revisiones. Puedes volver a los valores por defecto cuando quieras."
    )

    with st.expander("➕ Crear un nuevo tramite"):
        nuevo_nombre = st.text_input("Nombre del nuevo tramite", key="nuevo_tramite_nombre")
        if st.button("Crear tramite"):
            if nuevo_nombre.strip():
                tid = _slug(nuevo_nombre)
                if tid in tramites.TRAMITES:
                    st.warning("Ya existe un tramite con ese identificador.")
                else:
                    tramites.TRAMITES[tid] = {
                        "nombre": nuevo_nombre.strip(),
                        "descripcion": "",
                        "documentos": [],
                    }
                    config.guardar_tramites(tramites.TRAMITES)
                    st.success(f"Tramite '{nuevo_nombre}' creado.")
                    st.rerun()
            else:
                st.warning("Indica un nombre.")

    opciones = tramites.lista_tramites()
    if not opciones:
        st.info("No hay tramites. Crea uno arriba.")
        return

    etiquetas = [n for _, n in opciones]
    idx = st.selectbox(
        "Tramite a editar", range(len(opciones)), format_func=lambda i: etiquetas[i]
    )
    tramite_id = opciones[idx][0]
    tramite = tramites.TRAMITES[tramite_id]

    nombre = st.text_input("Nombre", value=tramite["nombre"], key=f"nom_{tramite_id}")
    descripcion = st.text_area(
        "Descripcion", value=tramite.get("descripcion", ""), key=f"desc_{tramite_id}"
    )

    st.markdown("##### Documentos exigidos")
    st.caption(
        "Anade, edita o elimina filas. 'Obligatorio' marca los que bloquean la "
        "presentacion; 'Caduca' los que conviene vigilar por fecha de caducidad."
    )
    df = pd.DataFrame(
        [
            {
                "ID": d["id"],
                "Documento": d["nombre"],
                "Obligatorio": bool(d["obligatorio"]),
                "Caduca": bool(d.get("caduca", False)),
                "Notas": d.get("notas", ""),
            }
            for d in tramite["documentos"]
        ]
    )
    if df.empty:
        df = pd.DataFrame(
            [{"ID": "", "Documento": "", "Obligatorio": True, "Caduca": False, "Notas": ""}]
        )
    editado = st.data_editor(
        df,
        num_rows="dynamic",
        hide_index=True,
        use_container_width=True,
        column_config={
            "Obligatorio": st.column_config.CheckboxColumn(),
            "Caduca": st.column_config.CheckboxColumn(),
        },
        key=f"docs_{tramite_id}",
    )

    c1, c2, c3 = st.columns([1, 1, 1])
    if c1.button("💾 Guardar tramite", type="primary"):
        documentos = []
        for _, fila in editado.iterrows():
            doc_nombre = str(fila["Documento"]).strip()
            if not doc_nombre:
                continue
            doc_id = str(fila["ID"]).strip() or _slug(doc_nombre)
            documentos.append(
                {
                    "id": doc_id,
                    "nombre": doc_nombre,
                    "obligatorio": bool(fila["Obligatorio"]),
                    "caduca": bool(fila["Caduca"]),
                    "notas": str(fila["Notas"]).strip(),
                }
            )
        tramites.TRAMITES[tramite_id] = {
            "nombre": nombre.strip() or tramite["nombre"],
            "descripcion": descripcion.strip(),
            "documentos": documentos,
        }
        config.guardar_tramites(tramites.TRAMITES)
        st.success("Tramite guardado.")
        st.rerun()

    if c2.button("🗑️ Eliminar este tramite"):
        del tramites.TRAMITES[tramite_id]
        config.guardar_tramites(tramites.TRAMITES)
        st.success("Tramite eliminado.")
        st.rerun()

    if c3.button("↩️ Restablecer todos por defecto"):
        config.restablecer_tramites()
        st.success("Tramites restablecidos a los valores por defecto.")
        st.rerun()


# --------------------------------------------------------------------------- #
#  Pagina: Gestoria (membrete)
# --------------------------------------------------------------------------- #
def pagina_gestoria():
    st.title("Datos de la gestoria")
    st.caption("Estos datos y el logo apareceran como membrete en los informes Word y PDF.")
    cfg = config.cargar_config()

    nombre = st.text_input("Nombre de la gestoria", value=cfg.get("nombre_gestoria", ""))
    direccion = st.text_input("Direccion", value=cfg.get("direccion", ""))
    col1, col2 = st.columns(2)
    telefono = col1.text_input("Telefono", value=cfg.get("telefono", ""))
    email = col2.text_input("Email", value=cfg.get("email", ""))

    if st.button("💾 Guardar datos", type="primary"):
        config.guardar_config(
            {
                "nombre_gestoria": nombre.strip(),
                "direccion": direccion.strip(),
                "telefono": telefono.strip(),
                "email": email.strip(),
                "logo_path": cfg.get("logo_path", ""),
            }
        )
        st.success("Datos guardados.")
        st.rerun()

    st.divider()
    st.markdown("##### Logo")
    logo_actual = cfg.get("logo_path", "")
    if logo_actual and os.path.exists(logo_actual):
        st.image(logo_actual, width=160)
        if st.button("Quitar logo"):
            config.eliminar_logo()
            st.rerun()
    logo = st.file_uploader("Subir logo (PNG o JPG)", type=["png", "jpg", "jpeg"])
    if logo is not None and st.button("Guardar logo"):
        try:
            config.guardar_logo(logo.getvalue(), logo.name)
            st.success("Logo guardado.")
            st.rerun()
        except ValueError as exc:
            st.error(str(exc))


# --------------------------------------------------------------------------- #
#  Render comun de resultados + descargas
# --------------------------------------------------------------------------- #
def mostrar_resultados(resultados, tramite_id, solicitante, hoy, prefijo="rev"):
    if tramite_id not in tramites.TRAMITES:
        st.error("El tramite de este expediente ya no existe. Vuelve a crearlo para verlo.")
        return

    checklist, no_identificados = analizador.evaluar_expediente(resultados, tramite_id)
    listo = analizador.expediente_listo(checklist)

    if listo:
        st.success("✅ Expediente completo: no faltan obligatorios ni hay caducados.")
    else:
        st.error("⛔ Expediente incompleto: revisa los documentos marcados abajo.")

    faltan = sum(1 for c in checklist if c["estado"] == "falta")
    caducados = sum(1 for c in checklist if c["estado"] == "caducado")
    avisos = sum(1 for c in checklist if c["estado"] in ("con_incidencias", "proximo_a_caducar"))
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

    gestoria = config.cargar_config()
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
            key=f"{prefijo}_md",
        )
    with d2:
        try:
            docx_bytes = informe.generar_docx(
                checklist, no_identificados, tramite_id,
                solicitante=solicitante, hoy=hoy, gestoria=gestoria,
            )
            st.download_button(
                "⬇️ Word (.docx)",
                data=docx_bytes,
                file_name=f"informe_{nombre_base}_{fecha}.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True,
                key=f"{prefijo}_docx",
            )
        except Exception as exc:  # noqa: BLE001
            st.caption(f"Word no disponible: {exc}")
    with d3:
        try:
            pdf_bytes = informe.generar_pdf(
                checklist, no_identificados, tramite_id,
                solicitante=solicitante, hoy=hoy, gestoria=gestoria,
            )
            st.download_button(
                "⬇️ PDF (.pdf)",
                data=pdf_bytes,
                file_name=f"informe_{nombre_base}_{fecha}.pdf",
                mime="application/pdf",
                use_container_width=True,
                key=f"{prefijo}_pdf",
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
    for inc in doc.get("incidencias", []):
        st.warning(inc)


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #
def main():
    pagina, api_key, modelo, dias_aviso = barra_lateral()
    if pagina == "Revisar expediente":
        pagina_revisar(api_key, modelo, dias_aviso)
    elif pagina == "Historial":
        pagina_historial()
    elif pagina == "Tramites":
        pagina_tramites()
    elif pagina == "Gestoria":
        pagina_gestoria()


if __name__ == "__main__":
    main()
