export const eur = (n: number | null | undefined) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));

export const dateIt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("it-IT") : "—";

export const num = (n: number | null | undefined, dec = 2) =>
  new Intl.NumberFormat("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(
    Number(n ?? 0),
  );
