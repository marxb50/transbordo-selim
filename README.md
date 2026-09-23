# SELIM · Transbordo

Aplicativo para registrar carretas e coletores/bairros em dois fluxos simples.
Interface estática no GitHub Pages; dados operacionais na **cópia** da planilha
de carretas da conta `marxb50@gmail.com`, via Apps Script. Os Forms e planilhas
originais da conta `brasilbrazil2202@gmail.com` não são alterados.

## Uso

- **Carretas:** registrar saída sem peso; no retorno, selecionar a saída e
  informar o peso do comprovante em kg ou toneladas. O servidor grava o peso
  em kg, vinculado a uma única viagem.
- **Coletores / bairros:** registrar placa, bairro e fiscal; a carreta e a
  viagem são opcionais. O horário é automático. Não é necessário registrar o
  coletor antes da saída da carreta.
- **Relatório:** botão pequeno no rodapé, protegido por senha alterável; mostra
  totais por carreta, semana/mês, gráficos, comparações e qualidade dos dados.
  O peso pertence à viagem da carreta; não é dividido entre coletores.

Novos lançamentos entram nas abas `Viagens_Carretas` e `Registros_Coletores`
da [cópia de carretas](https://docs.google.com/spreadsheets/d/1zrrpnGf05A_7aAhvTis9DKYZZqlad5onXpwSSvAZyOM/edit).
O histórico antigo dessa planilha e da
[cópia de coletores](https://docs.google.com/spreadsheets/d/1EwM6Cqf30MMbPTtTlfz2dwNFUppT_Y9HHPRuNzluUCU/edit)
é somente lido. O importador só soma viagens antigas com placa, manifesto,
peso e data conciliáveis; conflitos e testes ficam fora, com contagem de
pendências no relatório. O carimbo do Forms histórico é uma aproximação da
data de retorno. Os coletores antigos não contêm vínculo com carreta ou
manifesto, então não há atribuição de peso antigo por coletor/bairro.

As cópias históricas são instantâneos: novos envios feitos nos Forms antigos
não aparecem automaticamente aqui. Para que novos registros componham o
relatório deste aplicativo, a equipe deve usar este novo link.

## Desenvolvimento e implantação

- `index.html`, `styles.css`, `app.js`: interface GitHub Pages.
- `backend/Code.gs`, `backend/Legacy.gs`, `backend/Index.html`: Apps Script
  implantado no projeto copiado `TRANSBORDO — CÓPIA marxb50`.
- `SCRIPT_BRIDGE_URL` em `app.js`: URL da implantação do Apps Script.
- `REPORT_PASSWORD_SALT` e `REPORT_PASSWORD_HASH`: propriedades privadas do
  projeto Apps Script; nunca inserir a senha em `app.js` ou no repositório.
- Testes locais: `node --test backend/code.test.js backend/legacy-parser.test.js`.

Ao implantar Apps Script, executar como proprietário para que o formulário
possa registrar usuários que tenham apenas o link. A edição direta das
planilhas deve continuar restrita à conta responsável.
