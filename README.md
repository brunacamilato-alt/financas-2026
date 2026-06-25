# Fluxo de Caixa Local

App simples em HTML, CSS e JavaScript puro para:

- carregar automaticamente a planilha base `Fluxo Caixa_Carga.xlsx` na abertura;
- importar extratos em `.xlsx` ou `.csv`;
- reconhecer o padrao Data, Banco, Tipo Transacao, Transacao e Valor;
- aceitar colunas opcionais: Cliente/Fornecedor, No Cotacao/Pedido, Compromisso, Status e Categoria;
- lancar receitas e despesas futuras;
- editar ou excluir lancamentos manuais;
- editar ou excluir lancamentos importados do arquivo;
- registrar investimento/aporte e emprestimo de terceiros;
- ler uma ponte simples do caixa: caixa real, a receber, a pagar, caixa provavel, investimento Jan/2027 e sobra final;
- abrir drill-down por grupo para conferir os lancamentos que formam cada valor;
- usar ID do lancamento para facilitar edicao e conferencia;
- separar conta/origem de cliente, fornecedor ou pessoa;
- ver caixa separado por Santander, C6 e Banco do Brasil;
- marcar lancamentos previstos como realizados;
- acompanhar forecast mensal;
- exportar e importar backup JSON para proteger os dados locais.

Colunas sugeridas para carga:

- Data
- ID
- Conta
- Tipo
- Descricao
- Valor
- Cliente/Fornecedor
- No Cotacao/Pedido
- Compromisso
- Status
- Categoria

Abra `index.html` no navegador. Os lancamentos futuros e o ultimo extrato importado ficam salvos apenas no armazenamento local do navegador. Use `Exportar backup` periodicamente para guardar uma copia fora do navegador.

Se nao houver dados salvos, a aplicacao carrega `Fluxo Caixa_Carga.xlsx` automaticamente da propria pasta do app.
