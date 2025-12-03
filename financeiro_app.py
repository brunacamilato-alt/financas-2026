# financeiro_app.py
# Dashboard Financeiro Pessoal 2026 – Bruna & Juliana

import pandas as pd
import streamlit as st
from datetime import date

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

MES_MAP = {
    "Jan": 1, "Fev": 2, "Mar": 3, "Abr": 4,
    "Mai": 5, "Jun": 6, "Jul": 7, "Ago": 8,
    "Set": 9, "Out": 10, "Nov": 11, "Dez": 12,
}


def parse_mesref(mesref: str):
    """Converte 'Jan/26' em (ano, mes) -> (2026, 1)."""
    try:
        parte_mes, parte_ano = mesref.split("/")
        mes = MES_MAP.get(parte_mes[:3], 1)
        ano = 2000 + int(parte_ano)
        return ano, mes
    except Exception:
        return None, None


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


def montar_resumo(df_longo: pd.DataFrame) -> pd.DataFrame:
    """Resumo mensal (custos, entradas, saldo)."""
    base = df_longo.copy()

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

    # Pagador: radio igual à visão de valores
    pagador = st.radio(
        "Pagador:",
        ["Bruna", "Juliana", "Ambas"],
        index=2,
        horizontal=True,
    )

    # Categoria: radio em 3 grupos
    cat_choice = st.radio(
        "Filtrar por categoria:",
        ["Itens de Receitas e Saldos", "Itens de Custos", "Incluir todos os itens"],
        index=2,
        horizontal=True,
    )

    # Aplica filtros básicos sobre df_long
    df_base = df_long.copy()

    # Normaliza pagador para evitar problemas de espaço/letra maiúscula
    pag_series = df_base["Pagador"].fillna("").str.strip().str.lower()

    if pagador != "Ambas":
        if pagador == "Bruna":
            mask_pag = pag_series.str.contains("bruna")
        else:
            mask_pag = pag_series.str.contains("juliana")
        df_base = df_base[mask_pag]

    natureza_series_base = df_base["Natureza"].fillna("").str.strip().str.lower()
    if cat_choice == "Itens de Receitas e Saldos":
        df_base = df_base[natureza_series_base != "custo"]
    elif cat_choice == "Itens de Custos":
        df_base = df_base[natureza_series_base == "custo"]
    # "Incluir todos os itens" -> não filtra por natureza

    # Visão de valores
    visao = st.radio(
        "Visão de valores:",
        ["Planejado", "Realizado", "Ambos"],
        index=0,
        horizontal=True,
    )

    resumo = montar_resumo(df_base)

    if resumo.empty:
        st.warning("Nenhum dado encontrado para os filtros selecionados.")
        return

    # Marca meses vencidos em relação à data de hoje
    hoje = date.today()
    anos_meses = resumo["MesRef"].map(parse_mesref)
    resumo["Ano"], resumo["MesNum"] = zip(*anos_meses)

    resumo["MesPassado"] = resumo.apply(
        lambda r: (
            r["Ano"] is not None
            and r["MesNum"] is not None
            and (r["Ano"] < hoje.year or (r["Ano"] == hoje.year and r["MesNum"] < hoje.month))
        ),
        axis=1,
    )

    # ----------------------------------------------------------------
    # RESUMO ANUAL (KPIs) – com mesma dimensão para Prev e Real
    # ----------------------------------------------------------------
    st.markdown("---")
    st.subheader("Resumo anual (após filtros)")

    # Cópia para cálculo dos totais com lógica de "mês vencido"
    resumo_kpi = resumo.copy()
    resumo_kpi.loc[resumo_kpi["MesPassado"], ["Custos_Prev", "Receb_Prev", "Saldo_Prev"]] = 0.0

    # Totais
    total_c_prev = resumo_kpi["Custos_Prev"].sum()
    total_r_prev = resumo_kpi["Receb_Prev"].sum()
    total_s_prev = resumo_kpi["Saldo_Prev"].sum()

    total_c_real = resumo["Custos_Real"].sum()
    total_r_real = resumo["Receb_Real"].sum()
    total_s_real = resumo["Saldo_Real"].sum()

    # Linha Planejado
    if visao in ("Planejado", "Ambos"):
        col_p1, col_p2, col_p3 = st.columns(3)
        col_p1.metric("Gastos – Previsto (Ano)", fmt_br(total_c_prev))
        col_p2.metric("Entradas – Previstas (Ano)", fmt_br(total_r_prev))
        col_p3.metric("Saldo – Previsto (Ano)", fmt_br(total_s_prev))

    # Linha Realizado
    if visao in ("Realizado", "Ambos"):
        col_r1, col_r2, col_r3 = st.columns(3)

        if visao == "Ambos":
            delta_c = total_c_real - total_c_prev
            delta_r = total_r_real - total_r_prev
            delta_s = total_s_real - total_s_prev

            col_r1.metric(
                "Gastos – Real (Ano)",
                fmt_br(total_c_real),
                delta=f"{fmt_br(delta_c)} vs Prev.",
            )
            col_r2.metric(
                "Entradas – Reais (Ano)",
                fmt_br(total_r_real),
                delta=f"{fmt_br(delta_r)} vs Prev.",
            )
            col_r3.metric(
                "Saldo – Real (Ano)",
                fmt_br(total_s_real),
                delta=f"{fmt_br(delta_s)} vs Prev.",
            )
        else:
            col_r1.metric("Gastos – Real (Ano)", fmt_br(total_c_real))
            col_r2.metric("Entradas – Reais (Ano)", fmt_br(total_r_real))
            col_r3.metric("Saldo – Real (Ano)", fmt_br(total_s_real))

    st.caption(
        "Obs: Nos meses já vencidos, o planejado é desconsiderado nos totais anuais para manter a visão Real + Forecast."
    )

    # ----------------------------------------------------------------
    # TABELA RESUMO MENSAL – com cores apenas nos saldos
    # ----------------------------------------------------------------
    st.markdown("---")
    st.subheader("Resumo mensal")

    tabela = resumo.copy()

    # Remove meses totalmente zerados (todas as métricas = 0)
    cols_val = [c for c in tabela.columns if c.startswith(("Custos_", "Receb_", "Saldo_"))]
    if cols_val:
        soma_abs = tabela[cols_val].abs().sum(axis=1)
        tabela = tabela[soma_abs != 0].reset_index(drop=True)

    # Reordena meses de acordo com MONTH_ORDER
    tabela["MesOrd"] = tabela["MesRef"].apply(
        lambda x: MONTH_ORDER.index(x) if x in MONTH_ORDER else 99
    )
    tabela = tabela.sort_values("MesOrd").drop(columns=["MesOrd"])

    # Garante precisão controlada na coluna de variação percentual
    if "Var_Saldo_%" in tabela.columns:
        tabela["Var_Saldo_%"] = pd.to_numeric(tabela["Var_Saldo_%"], errors="coerce").fillna(0).round(4)

    # Decide quais colunas exibir conforme a visão
    if visao == "Planejado":
        cols = ["MesRef", "Custos_Prev", "Receb_Prev", "Saldo_Prev"]
    elif visao == "Realizado":
        cols = ["MesRef", "Custos_Real", "Receb_Real", "Saldo_Real"]
    else:  # Ambos
        cols = [
            "MesRef",
            "Custos_Prev", "Receb_Prev", "Saldo_Prev",
            "Custos_Real", "Receb_Real", "Saldo_Real",
            "Var_Saldo_%",
        ]

    def color_saldo(v):
        if pd.isna(v):
            return ""
        # Aceita tanto números quanto strings formatadas (ex.: 'R$ 3.500,00')
        if isinstance(v, (int, float)):
            v_float = float(v)
        else:
            s = str(v).strip()
            s = s.replace("R$", "").replace(" ", "")
            # Se usar padrão brasileiro (vírgula como decimal), trata adequadamente
            if "," in s:
                s = s.replace(".", "").replace(",", ".")
            try:
                v_float = float(s)
            except Exception:
                return ""
        if v_float < 0:
            return "background-color: #f8d0d0;"   # vermelho claro
        elif v_float > 2000:
            return "background-color: #d4f5d4;"   # verde
        else:
            return "background-color: #fff7cc;"   # amarelo

    tabela_exib = tabela[cols].copy()
    # Ajusta índice para contar meses de 1 a N (Jan=1, ..., Dez=N)
    tabela_exib.index = range(1, len(tabela_exib) + 1)
    # Converte colunas monetárias para string já formatada em moeda BR
    cols_moeda = [c for c in cols if c.startswith(("Custos_", "Receb_", "Saldo_"))]
    for c in cols_moeda:
        if c in tabela_exib.columns:
            serie_num = pd.to_numeric(tabela_exib[c], errors="coerce").fillna(0).round(2)
            tabela_exib[c] = serie_num.apply(fmt_br)

    styler = tabela_exib.style

    # Formatação de percentual
    if "Var_Saldo_%" in cols:
        styler = styler.format(
            {"Var_Saldo_%": lambda v: f"{v * 100:.1f}%".replace(".", ",")}
        )

    # Aplica cores somente aos saldos
    saldo_cols = [c for c in cols if c.startswith("Saldo_")]
    if saldo_cols:
        styler = styler.applymap(color_saldo, subset=saldo_cols)

    st.dataframe(styler, use_container_width=True, height=520)

    # ----------------------------------------------------------------
    # RANKING DE CUSTOS (EVOLUÇÃO NO TEMPO) – após Resumo Mensal
    # ----------------------------------------------------------------
    st.subheader("Ranking de custos por categoria (evolução no tempo)")

    # Visão de valores específica do ranking (independente do resumo)
    visao_rank = st.radio(
        "Visão de valores (ranking):",
        ["Planejado", "Realizado", "Ambos"],
        index=0,
        horizontal=True,
        key="visao_ranking",
    )

    base_rank = df_base.copy()
    natureza_rank = base_rank["Natureza"].fillna("").str.strip().str.lower()
    base_rank = base_rank[natureza_rank == "custo"]

    if base_rank.empty:
        st.info("Nenhum custo encontrado para os filtros selecionados.")
        return

    # Agrega Prev / Real por categoria e mês
    agr = (
        base_rank
        .groupby(["Categoria", "MesRef"])[["Prev", "Real"]]
        .sum()
        .reset_index()
    )

    # Marca meses passados
    anos_meses_rank = agr["MesRef"].map(parse_mesref)
    agr["Ano"], agr["MesNum"] = zip(*anos_meses_rank)
    agr["MesPassado"] = agr.apply(
        lambda r: (
            r["Ano"] is not None
            and r["MesNum"] is not None
            and (r["Ano"] < hoje.year or (r["Ano"] == hoje.year and r["MesNum"] < hoje.month))
        ),
        axis=1,
    )

    # Zera Prev nos meses passados (Planejado e Ambos)
    if visao_rank in ("Planejado", "Ambos"):
        agr.loc[agr["MesPassado"], "Prev"] = 0.0

    # Garante ordem dos meses
    meses_usados = [m for m in MONTH_ORDER if m in agr["MesRef"].unique()]

    linhas = []
    for cat in sorted(agr["Categoria"].dropna().unique()):
        sub = agr[agr["Categoria"] == cat]
        linha = {"Categoria": cat}

        for mes in meses_usados:
            rec = sub[sub["MesRef"] == mes]
            prev_val = float(rec["Prev"].iloc[0]) if not rec.empty else 0.0
            real_val = float(rec["Real"].iloc[0]) if not rec.empty else 0.0

            if visao_rank in ("Planejado", "Ambos"):
                linha[f"{mes} Prev"] = prev_val
            if visao_rank in ("Realizado", "Ambos"):
                linha[f"{mes} Real"] = real_val

        # totais para ordenação
        total_real = sum(
            linha.get(f"{mes} Real", 0.0) for mes in meses_usados
        )
        total_prev = sum(
            linha.get(f"{mes} Prev", 0.0) for mes in meses_usados
        )
        linha["_total_real"] = total_real
        linha["_total_prev"] = total_prev

        linhas.append(linha)

    df_rank = pd.DataFrame(linhas)

    if visao_rank in ("Realizado", "Ambos"):
        df_rank = df_rank.sort_values("_total_real", ascending=False)
    else:  # Planejado
        df_rank = df_rank.sort_values("_total_prev", ascending=False)

    df_rank = df_rank.drop(columns=["_total_real", "_total_prev"], errors="ignore")

    # Arredonda colunas numéricas do ranking para 2 casas decimais
    cols_rank = [c for c in df_rank.columns if c != "Categoria"]
    for c in cols_rank:
        df_rank[c] = pd.to_numeric(df_rank[c], errors="coerce").fillna(0).round(2)

    # Formatação do ranking
    fmt_rank = {c: fmt_br for c in cols_rank}
    styler_rank = df_rank.style.format(fmt_rank)

    st.dataframe(styler_rank, use_container_width=True)

    st.caption(
        "Obs: Ranking considera apenas categorias com Natureza = Custo, "
        "ordenadas do maior para o menor custo anual."
    )


# --------------------------------------------------------------------
# ENTRYPOINT
# --------------------------------------------------------------------
if __name__ == "__main__":
    main()
