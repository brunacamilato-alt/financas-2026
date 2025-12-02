# financeiro_app.py
# Dashboard Financeiro Pessoal 2026 – Bruna & Juliana

import pandas as pd
import streamlit as st

# --------------------------------------------------------------------
# CONFIGURAÇÕES GERAIS
# --------------------------------------------------------------------

# URL do CSV publicado (Arquivo > Publicar na Web > CSV)
CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQdunAx32Ot89eu2zi2Pl5b2xt0N7fSX_goIrgNdRlqTuaNy3BDBB8QJMgmTCSdL_UIbxggagH8_Q6F/"
    "pub?gid=0&single=true&output=csv"
)

# URL da planilha para edição (normal, no Google Sheets)
SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/1qVcPQgOEx3hbc5bIb1I-b-D_1hmFHP1Ny6MSLdOYxrA"
    "/edit?usp=sharing"
)

# Ordem correta dos meses
MONTH_ORDER = [
    "Jan/26", "Fev/26", "Mar/26", "Abr/26",
    "Mai/26", "Jun/26", "Jul/26", "Ago/26",
    "Set/26", "Out/26", "Nov/26", "Dez/26",
]

# --------------------------------------------------------------------
# FUNÇÕES AUXILIARES
# --------------------------------------------------------------------


def limpa_moeda(valor):
    """Converte 'R$ 2.599,67' (ou similar) em float."""
    if pd.isna(valor):
        return 0.0
    if isinstance(valor, (int, float)):
        return float(valor)

    s = str(valor).strip()
    s = s.replace("R$", "").replace(" ", "")
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        return 0.0


def fmt_br(v: float) -> str:
    """Formata número como moeda BR."""
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def normalizar_colunas(df: pd.DataFrame) -> pd.DataFrame:
    """Garante que colunas principais existam com nomes padronizados."""
    renomear = {}
    for col in df.columns:
        low = str(col).strip().lower()
        if low.startswith("nature"):
            renomear[col] = "Natureza"
        elif low.startswith("categ"):
            renomear[col] = "Categoria"
        elif low.startswith("tipo"):
            renomear[col] = "Tipo"
        elif low.startswith("descr"):
            renomear[col] = "Descrição"
        elif low.startswith("pagador"):
            renomear[col] = "Pagador"

    df = df.rename(columns=renomear)

    for col in ["Natureza", "Categoria", "Tipo", "Descrição", "Pagador"]:
        if col not in df.columns:
            df[col] = None

    return df


# --------------------------------------------------------------------
# CARREGAMENTO E TRANSFORMAÇÃO DOS DADOS
# --------------------------------------------------------------------


@st.cache_data
def carregar_dados_long() -> pd.DataFrame:
    """Lê o CSV publicado e transforma em formato longo (uma linha por mês)."""
    df = pd.read_csv(CSV_URL)

    df = normalizar_colunas(df)

    # descobre colunas de Prev e Real
    col_prev = [c for c in df.columns if isinstance(c, str) and "prev" in c.lower()]
    col_real = [c for c in df.columns if isinstance(c, str) and "real" in c.lower()]

    def extrair_mes(nome: str) -> str:
        nome = nome.replace("Prev.", "").replace("Prev", "")
        nome = nome.replace("Real.", "").replace("Real", "")
        return nome.strip()

    meses = []
    for cp in col_prev:
        mes = extrair_mes(cp)
        cand = [c for c in col_real if extrair_mes(c) == mes]
        cr = cand[0] if cand else None
        meses.append((mes, cp, cr))

    registros = []
    for _, linha in df.iterrows():
        for mes, cp, cr in meses:
            registros.append(
                {
                    "Natureza": linha["Natureza"],
                    "Categoria": linha["Categoria"],
                    "Tipo": linha["Tipo"],
                    "Descrição": linha["Descrição"],
                    "Pagador": linha["Pagador"],
                    "MesRef": mes,
                    "Prev": limpa_moeda(linha.get(cp, 0)),
                    "Real": limpa_moeda(linha.get(cr, 0)),
                }
            )

    df_longo = pd.DataFrame(registros)

    # Ordena meses
    df_longo["MesOrd"] = df_longo["MesRef"].apply(
        lambda x: MONTH_ORDER.index(x) if x in MONTH_ORDER else 99
    )
    df_longo = df_longo.sort_values("MesOrd").drop(columns=["MesOrd"])

    return df_longo


def montar_resumo(df_longo: pd.DataFrame,
                  pagadores: list,
                  categorias: list) -> pd.DataFrame:
    """Resumo mensal (custos, entradas, saldo)."""
    base = df_longo.copy()

    if pagadores:
        base = base[base["Pagador"].isin(pagadores)]

    if categorias:
        base = base[base["Categoria"].isin(categorias)]

    # Define custos (Natureza = 'Custo') e entradas (todo o resto)
    natureza_series = base["Natureza"].fillna("").str.lower()
    custos_base = base[natureza_series == "custo"]
    entradas_base = base[natureza_series != "custo"]

    # Custos
    custos = (
        custos_base
        .groupby("MesRef")[["Prev", "Real"]]
        .sum()
        .rename(columns={"Prev": "Custos_Prev", "Real": "Custos_Real"})
    )

    # Entradas: receitas, saldo inicial, etc (tudo que não é custo)
    entradas = (
        entradas_base
        .groupby("MesRef")[["Prev", "Real"]]
        .sum()
        .rename(columns={"Prev": "Receb_Prev", "Real": "Receb_Real"})
    )

    resumo = custos.join(entradas, how="outer").fillna(0.0)

    resumo["Saldo_Prev"] = resumo["Receb_Prev"] - resumo["Custos_Prev"]
    resumo["Saldo_Real"] = resumo["Receb_Real"] - resumo["Custos_Real"]

    resumo["Var_Saldo_%"] = resumo.apply(
        lambda r: (r["Saldo_Real"] / r["Saldo_Prev"] - 1) if r["Saldo_Prev"] else 0.0,
        axis=1,
    )

    resumo = resumo.reset_index()
    resumo["MesOrd"] = resumo["MesRef"].apply(
        lambda x: MONTH_ORDER.index(x) if x in MONTH_ORDER else 99
    )
    resumo = resumo.sort_values("MesOrd").drop(columns=["MesOrd"])

    return resumo


# --------------------------------------------------------------------
# INTERFACE STREAMLIT
# --------------------------------------------------------------------


def main():
    st.set_page_config(
        page_title="Financeiro Pessoal 2026 – Visão Simplificada",
        layout="wide",
    )

    st.title("Financeiro Pessoal 2026 – Visão Simplificada")

    # Cabeçalho: link da planilha + botão de atualização
    col1, col2 = st.columns([3, 1])
    with col1:
        st.caption("Fonte de dados: Google Sheets (publicado em CSV).")
        st.markdown(f"[Abrir planilha para edição]({SHEET_URL})")

    with col2:
        if st.button("Atualizar dados agora"):
            # limpa o cache da função e força recarregar
            carregar_dados_long.clear()
            # compatível com versões novas/antigas
            if hasattr(st, "rerun"):
                st.rerun()
            elif hasattr(st, "experimental_rerun"):
                st.experimental_rerun()

    # Carrega dados
    df_long = carregar_dados_long()

    with st.expander("Ver amostra dos dados transformados"):
        st.write(df_long.head())

    # ----------------------------------------------------------------
    # FILTROS
    # ----------------------------------------------------------------
    st.markdown("---")
    st.subheader("Filtros")

    pagadores_disponiveis = sorted(df_long["Pagador"].dropna().unique())
    pagadores_sel = st.multiselect(
        "Pagador:",
        options=pagadores_disponiveis,
        default=pagadores_disponiveis,
    )

    categorias_disponiveis = sorted(df_long["Categoria"].dropna().unique())
    categorias_sel = st.multiselect(
        "Filtrar por categoria (opcional):",
        options=categorias_disponiveis,
        default=[],
    )

    visao = st.radio(
        "Visão de valores:",
        ["Plan & Real", "Planejado", "Realizado"],
        horizontal=True,
    )

    resumo = montar_resumo(df_long, pagadores_sel, categorias_sel)

    if resumo.empty:
        st.warning("Nenhum dado encontrado para os filtros selecionados.")
        return

    # ----------------------------------------------------------------
    # RESUMO ANUAL (KPIs)
    # ----------------------------------------------------------------
    st.markdown("---")
    st.subheader("Resumo anual (após filtros)")

    # Totais
    total_c_prev = resumo["Custos_Prev"].sum()
    total_c_real = resumo["Custos_Real"].sum()
    total_r_prev = resumo["Receb_Prev"].sum()
    total_r_real = resumo["Receb_Real"].sum()
    total_s_prev = resumo["Saldo_Prev"].sum()
    total_s_real = resumo["Saldo_Real"].sum()

    col_a, col_b, col_c = st.columns(3)

    if visao == "Planejado":
        col_a.metric("Gastos – Previsto (Ano)", fmt_br(total_c_prev))
        col_b.metric("Entradas – Previstas (Ano)", fmt_br(total_r_prev))
        col_c.metric("Saldo – Previsto (Ano)", fmt_br(total_s_prev))

    elif visao == "Realizado":
        col_a.metric("Gastos – Real (Ano)", fmt_br(total_c_real))
        col_b.metric("Entradas – Reais (Ano)", fmt_br(total_r_real))
        col_c.metric("Saldo – Real (Ano)", fmt_br(total_s_real))

    else:
        delta_c = total_c_real - total_c_prev
        delta_r = total_r_real - total_r_prev
        delta_s = (total_s_real - total_s_prev)

        col_a.metric(
            "Gastos – Real (Ano)",
            fmt_br(total_c_real),
            delta=f"{fmt_br(delta_c)} vs Prev.",
        )
        col_b.metric(
            "Entradas – Reais (Ano)",
            fmt_br(total_r_real),
            delta=f"{fmt_br(delta_r)} vs Prev.",
        )
        col_c.metric(
            "Saldo – Real (Ano)",
            fmt_br(total_s_real),
            delta=f"{fmt_br(delta_s)} vs Prev.",
        )

    # ----------------------------------------------------------------
    # TABELA RESUMO MENSAL
    # ----------------------------------------------------------------
    st.markdown("---")
    st.subheader("Resumo mensal")

    tabela = resumo.copy()

    # Decide quais colunas exibir conforme a visão
    if visao == "Planejado":
        cols = ["MesRef", "Custos_Prev", "Receb_Prev", "Saldo_Prev"]
    elif visao == "Realizado":
        cols = ["MesRef", "Custos_Real", "Receb_Real", "Saldo_Real"]
    else:
        cols = [
            "MesRef",
            "Custos_Prev", "Custos_Real",
            "Receb_Prev", "Receb_Real",
            "Saldo_Prev", "Saldo_Real",
            "Var_Saldo_%",
        ]

    # Formatação
    for c in [
        "Custos_Prev", "Custos_Real",
        "Receb_Prev", "Receb_Real",
        "Saldo_Prev", "Saldo_Real",
    ]:
        if c in tabela.columns:
            tabela[c] = tabela[c].map(fmt_br)

    if "Var_Saldo_%" in tabela.columns:
        tabela["Var_Saldo_%"] = tabela["Var_Saldo_%"].map(
            lambda v: f"{v*100:.1f}%".replace(".", ",")
        )

    st.dataframe(tabela[cols], use_container_width=True, height=360)


# --------------------------------------------------------------------
# ENTRYPOINT
# --------------------------------------------------------------------
if __name__ == "__main__":
    main()
