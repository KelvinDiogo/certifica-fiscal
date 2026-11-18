export const TYPES = {
  federal: "Federal — RFB/PGFN",
  estadual: "Estadual",
  municipal: "Municipal",
  fgts: "FGTS",
  trabalhista: "Trabalhista — CNDT",
};
export const RESULTS = {
  negativa: "Negativa",
  positiva_efeitos_negativa: "Positiva com efeitos de negativa",
  positiva: "Positiva",
  nao_verificada: "Não verificada",
};
export const STATES =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  );
export function cleanCnpj(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[.\/\-\s]/g, "");
}
export function validCnpj(input) {
  const c = cleanCnpj(input);
  if (!/^[A-Z\d]{12}\d{2}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const digit = (s) => {
    const weights =
      s.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r =
      [...s].reduce(
        (sum, x, i) => sum + (x.charCodeAt(0) - 48) * weights[i],
        0,
      ) % 11;
    return String(r < 2 ? 0 : 11 - r);
  };
  return digit(c.slice(0, 12)) === c[12] && digit(c.slice(0, 13)) === c[13];
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function validDate(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function certificateState(c, date = today()) {
  if (c.expires_at < date) return "expired";
  if (c.result === "positiva") return "irregular";
  if (c.result === "nao_verificada") return "unknown";
  const days = Math.round(
    (Date.parse(c.expires_at) - Date.parse(date)) / 86400000,
  );
  return days <= 30 ? "expiring" : "regular";
}
export function latestCertificates(records) {
  const latest = new Map();
  for (const c of records) {
    const key = c.company_id + ":" + c.type;
    const prev = latest.get(key);
    if (
      !prev ||
      c.issued_at > prev.issued_at ||
      (c.issued_at === prev.issued_at && c.created_at > prev.created_at)
    )
      latest.set(key, c);
  }
  return [...latest.values()];
}
export function csvCell(v) {
  let s = String(v ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
