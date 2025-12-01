import pandas as pd
import streamlit as st

# ---------------------------------------------------------
# CONFIGURAÇÃO BÁSICA
# ---------------------------------------------------------
st.set_page_config(
    page_title="Financeiro Pessoal 2026",
    layout="wide"
)

# URL da planilha publicada em CSV (base de dados do app)
CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQdunAx32Ot89eu2zi2Pl5b2xt0N7fSX_goIrgNdRlqTuaNy3BDBB8QJMgmTCSdL_UIbxggagH8_Q6F/"
    "pub?gid=0&single=true&output=csv"
)

# URL para abrir a planilha (troque pelo link de edição se quiser)
SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vQdunAx32Ot89eu2zi2Pl5b2xt0N7fSX_goIrgNdRlqTuaNy3BDBB8QJMgmTCSdL_UIbxggagH8_Q6F/"
    "pub?gid=0&single=true&output=html"
)

# Colunas fixas de identificação
ID_COLS = ["Natureza", "Categoria", "Tipo", "Descrição", "Pagador"]

# Mapa de meses abreviados -> número
MONTH_MAP = {
    "Jan": 1, "Fev": 2, "Mar": 3, "Abr": 4,
    "Mai": 5, "Jun": 6, "Jul": 7, "Ago": 8,
    "Set": 9, "Out": 10, "Nov": 11, "Dez": 12
}

ANO_ALVO = 2026


# ---------------------------------------------------------
# CARREGAMENTO E TRANSFORMAÇÃO
# ---------------------------------------------------------
@st.cache_data
def carregar_dados_long() -> pd.DataFrame:
    """
    Lê a planilha pivotada (Prev./Real.) e transforma em formato longo:

    Natureza | Categoria | Tipo | Descrição | Pagador |
    Ano | MesNum | Mes | Cenario (Plan/Real) | Valor
    """
    df = pd.read_csv(CSV_URL)

    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")
    if "Natureza" in df.columns:
        df = df.dropna(subset=["Natureza"])

    for col in ID_COLS:
        if col not in df.columns:
            df[col] = ""

    value_cols = [c for c in df.columns if c not in ID_COLS]

    linhas = []

    for col in value_cols:
        if not isinstance(col, str):
            continue
        if "/" not in col or ("Prev" not in col and "Real" not in col):
            continue

        try:
            mes_ano_part, scen_label = col.split(" ", 1)
            mes_abbr, ano_suf = mes_ano_part.split("/")
        except ValueError:
            continue

        mes_abbr = mes_abbr.strip()
        ano_suf = ano_suf.strip()

        ano = 2000 + int(ano_suf)
        mes_num = MONTH_MAP.get(mes_abbr, 0)
        cenario = "Plan" if "Prev" in scen_label else "Real"

        sub = df[ID_COLS + [col]].copy()
        sub = sub.rename(columns={col: "Valor"})
        sub["Ano"] = ano
        sub["MesNum"] = mes_num
        sub["Mes"] = mes_ano_part
        sub["Cenario"] = cenario

        linhas.append(sub)

    df_long = pd.concat(linhas, ignore_index=True)

    df_long["Natureza"] = df_long["Natureza"].astype(str).str.strip()
    df_long["Categoria"] = df_long["Categoria"].astype(str).str.strip()
    df_long["Pagador"] = df_long["Pagador"].astype(str).str.strip()
    df_long["Valor"] = pd.to_numeric(df_long["Valor"], errors="coerce").fillna(0)

    return df_long


def tabela_mensal(df_long: pd.DataFrame, ano: int, natureza: str) -> pd.DataFrame:
    """
    MesNum | Mes | Plan | Real
    """
    df_ano = df_long[(df_long["Ano"] == ano) &
                     (df_long["Natureza"] == natureza)]

    if df_ano.empty:
        return pd.DataFrame(columns=["MesNum", "Mes", "Plan", "Real"])

    grp = (
        df_ano
        .groupby(["MesNum", "Mes", "Cenario"], as_index=False)["Valor"]
        .sum()
    )

    pivot = grp.pivot(index=["MesNum", "Mes"],
                      columns="Cenario",
                      values="Valor").fillna(0)

    for col in ["Plan", "Real"]:
        if col not in pivot.columns:
            pivot[col] = 0

    pivot = pivot.reset_index().sort_values("MesNum")
    return pivot[["MesNum", "Mes", "Plan", "Real"]]


def tabela_saldo_mensal(df_long: pd.DataFrame, ano: int) -> pd.DataFrame:
    """
    Saldo = Receita - Custo + Saldo Inicial (Plan e Real)
    """
    rec = tabela_mensal(df_long, ano, "Receita")
    cus = tabela_mensal(df_long, ano, "Custo")
    sal = tabela_mensal(df_long, ano, "Saldo Inicial")

    def renomear(df, prefixo):
        if df.empty:
            return pd.DataFrame(columns=["MesNum", "Mes", f"{prefixo}_Plan", f"{prefixo}_Real"])
        return df[["MesNum", "Mes", "Plan", "Real"]].rename(
            columns={"Plan": f"{prefixo}_Plan", "Real": f"{prefixo}_Real"}
        )

    rec2 = renomear(rec, "Rec")
    cus2 = renomear(cus, "Cus")
    sal2 = renomear(sal, "Ini")

    base = pd.merge(rec2, cus2, on=["MesNum", "Mes"], how="outer")
    base = pd.merge(base, sal2, on=["MesNum", "Mes"], how="outer").fillna(0)

    base["Saldo_Plan"] = base["Rec_Plan"] - base["Cus_Plan"] + base["Ini_Plan"]
    base["Saldo_Real"] = base["Rec_Real"] - base["Cus_Real"] + base["Ini_Real"]

    base = base.sort_values("MesNum")
    return base[["MesNum", "Mes", "Saldo_Plan", "Saldo_Real"]]


# ---------------------------------------------------------
# APP
# ---------------------------------------------------------
def main():
    st.title("Financeiro Pessoal 2026 – Visão Simplificada")

    df_long_original = carregar_dados_long()

    with st.expander("Ver amostra dos dados transformados"):
        st.write(df_long_original.head())

    # ---------------------------------------------
    # FILTROS SIMPLES
    # ---------------------------------------------
    df_long = df_long_original.copy()

    st.markdown("#### Filtros")

    # Pagador
    pagadores = sorted(df_long["Pagador"].dropna().unique().tolist())
    sel_pagadores = st.multiselect(
        "Pagador:",
        options=pagadores,
        default=pagadores
    )
    if sel_pagadores:
        df_long = df_long[df_long["Pagador"].isin(sel_pagadores)]

    # Categoria opcional
    with st.expander("Filtrar por categoria (opcional)", expanded=False):
        categorias = sorted(df_long["Categoria"].dropna().unique().tolist())
        sel_categorias = st.multiselect(
            "Categoria:",
            options=categorias,
            default=categorias
        )
        if sel_categorias:
            df_long = df_long[df_long["Categoria"].isin(sel_categorias)]

    st.markdown("---")

    # ---------------------------------------------
    # TABELA ANUAL SIMPLES
    # ---------------------------------------------
    st.markdown("### Tabela anual – mês a mês (Plan x Real)")

    rec = tabela_mensal(df_long, ANO_ALVO, "Receita")
    cus = tabela_mensal(df_long, ANO_ALVO, "Custo")
    sal = tabela_saldo_mensal(df_long, ANO_ALVO)

    rec = rec.rename(columns={"Plan": "Receita_Plan", "Real": "Receita_Real"})
    cus = cus.rename(columns={"Plan": "Custo_Plan", "Real": "Custo_Real"})
    sal = sal.rename(columns={"Saldo_Plan": "Saldo_Plan", "Saldo_Real": "Saldo_Real"})

    df_mes = pd.merge(rec, cus, on=["MesNum", "Mes"], how="outer")
    df_mes = pd.merge(df_mes, sal, on=["MesNum", "Mes"], how="outer").fillna(0)

    df_mes = df_mes.sort_values("MesNum")[[
        "Mes",
        "Receita_Plan", "Receita_Real",
        "Custo_Plan", "Custo_Real",
        "Saldo_Plan", "Saldo_Real"
    ]]

    if not df_mes.empty:

        def color_row(row):
            styles = []
            for col in row.index:
                color = ""

                # COLORIR APENAS SALDO PLAN E SALDO REAL
                if col in ["Saldo_Plan", "Saldo_Real"]:
                    v = row[col]
                    if v < 0:
                        color = "#ffd6d6"   # vermelho pastel
                    elif v < 2000:
                        color = "#fff7bf"  # amarelo pastel
                    else:
                        color = "#d6f5d6"  # verde pastel

                styles.append(f"background-color: {color}" if color else "")
            return styles

        styled = (
            df_mes.style
            .apply(color_row, axis=1)
            .format({
                "Receita_Plan": "{:,.2f}",
                "Receita_Real": "{:,.2f}",
                "Custo_Plan": "{:,.2f}",
                "Custo_Real": "{:,.2f}",
                "Saldo_Plan": "{:,.2f}",
                "Saldo_Real": "{:,.2f}",
            })
        )

        st.dataframe(styled, use_container_width=True)
    else:
        st.info("Não há dados para os filtros selecionados.")

    # ---------------------------------------------
    # RESUMO ANUAL – PLAN E REAL
    # ---------------------------------------------
    st.markdown("---")
    st.markdown("### Resumo anual (Plan x Real)")

    if not df_mes.empty:
        total_rec_plan = df_mes["Receita_Plan"].sum()
        total_cus_plan = df_mes["Custo_Plan"].sum()
        total_sal_plan = df_mes["Saldo_Plan"].sum()

        total_rec_real = df_mes["Receita_Real"].sum()
        total_cus_real = df_mes["Custo_Real"].sum()
        total_sal_real = df_mes["Saldo_Real"].sum()

        c1, c2, c3 = st.columns(3)
        with c1:
            st.metric("Receita total (Plan)", f"{total_rec_plan:,.2f}")
        with c2:
            st.metric("Custo total (Plan)", f"{total_cus_plan:,.2f}")
        with c3:
            st.metric("Saldo acumulado (Plan)", f"{total_sal_plan:,.2f}")

        c4, c5, c6 = st.columns(3)
        with c4:
            st.metric("Receita total (Real)", f"{total_rec_real:,.2f}")
        with c5:
            st.metric("Custo total (Real)", f"{total_cus_real:,.2f}")
        with c6:
            st.metric("Saldo acumulado (Real)", f"{total_sal_real:,.2f}")
    else:
        st.info("Resumo anual indisponível (sem dados para os filtros).")

    # ---------------------------------------------
    # DETALHE DE UM MÊS (Plan ou Real)
    # ---------------------------------------------
    st.markdown("---")
    st.markdown("### Detalhe de um mês")

    meses_disp = df_mes["Mes"].tolist()
    if meses_disp:
        col_mes, col_cen = st.columns(2)
        with col_mes:
            mes_sel = st.selectbox("Escolha o mês:", meses_disp)
        with col_cen:
            cen_sel = st.selectbox("Cenário:", ["Real", "Plan"])

        df_det = df_long[
            (df_long["Ano"] == ANO_ALVO) &
            (df_long["Mes"] == mes_sel) &
            (df_long["Cenario"] == cen_sel)
        ].copy()

        st.markdown(
            f"[Abrir planilha no Google Sheets para editar valores]({SHEET_URL})"
        )

        if not df_det.empty:
            df_det = df_det[
                ["Natureza", "Categoria", "Tipo", "Descrição", "Pagador", "Valor"]
            ].sort_values(["Natureza", "Categoria", "Descrição"])

            st.dataframe(
                df_det.style.format({"Valor": "{:,.2f}"}),
                use_container_width=True
            )
        else:
            st.info(f"Ainda não há valores de **{cen_sel}** para {mes_sel}.")
    else:
        st.info("Tabela anual vazia para os filtros atuais.")


if __name__ == "__main__":
    main()
