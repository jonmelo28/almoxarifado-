const quantityFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});
export const formatQuantity = (value) => quantityFormat.format(value);
export const quantityFields = new Set([
  "saldo",
  "estoque_minimo",
  "quantidade",
  "saldo_anterior",
  "saldo_posterior",
]);
