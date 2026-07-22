import { supabase } from "@/integrations/supabase/client";

export async function seedDemoData() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Non autenticato");
  const { data: prof } = await supabase.from("profiles").select("organization_id").eq("id", u.user.id).single();
  const org = prof?.organization_id;
  if (!org) throw new Error("Nessuna organizzazione");

  // Clienti
  const clienti = [
    { ragione_sociale: "Condominio Via Garibaldi 12", partita_iva: "01234567890", citta: "Milano", provincia: "MI", cap: "20121", email: "amm@garibaldi12.it", telefono: "02 1234567", referente: "Dott. Bianchi" },
    { ragione_sociale: "Immobiliare Verdi S.r.l.", partita_iva: "02345678901", citta: "Torino", provincia: "TO", cap: "10121", email: "info@verdi.it", telefono: "011 234567", referente: "Ing. Verdi" },
    { ragione_sociale: "Comune di Bergamo", codice_fiscale: "80000000163", citta: "Bergamo", provincia: "BG", cap: "24121", email: "llpp@comune.bergamo.it", referente: "Arch. Colombo" },
    { ragione_sociale: "Famiglia Ferrari", codice_fiscale: "FRRLRC80A01F205X", citta: "Como", provincia: "CO", cap: "22100", telefono: "031 987654", referente: "Sig. Ferrari" },
    { ragione_sociale: "Hotel Belvedere S.p.A.", partita_iva: "03456789012", citta: "Bellagio", provincia: "CO", cap: "22021", email: "direzione@belvedere.it", telefono: "031 950123" },
  ].map((c) => ({ ...c, organization_id: org }));
  const { data: cli } = await supabase.from("clienti").insert(clienti).select("id, ragione_sociale");

  // Fornitori
  const fornitori = [
    { ragione_sociale: "Cementi Lombardia S.p.A.", categoria: "Materiali", partita_iva: "04567890123", citta: "Milano", provincia: "MI", email: "ordini@cementi-lombardia.it" },
    { ragione_sociale: "Ferramenta Bianchi", categoria: "Utensili", partita_iva: "05678901234", citta: "Bergamo", provincia: "BG", email: "info@bianchi.it" },
    { ragione_sociale: "Noleggi Edili Rossi", categoria: "Noleggio", partita_iva: "06789012345", citta: "Milano", provincia: "MI", email: "noleggi@rossi.it" },
    { ragione_sociale: "Elettro Impianti S.n.c.", categoria: "Subappalto", partita_iva: "07890123456", citta: "Como", provincia: "CO", email: "info@elettro.it" },
    { ragione_sociale: "Trasporti Alpi", categoria: "Trasporti", partita_iva: "08901234567", citta: "Sondrio", provincia: "SO", email: "logistica@alpi.it" },
  ].map((f) => ({ ...f, organization_id: org }));
  await supabase.from("fornitori").insert(fornitori);

  const cliMap = new Map((cli ?? []).map((c) => [c.ragione_sociale, c.id]));

  // Preventivi
  const preventivi = [
    { numero: "2025/001", oggetto: "Ristrutturazione facciata condominio", cliente_id: cliMap.get("Condominio Via Garibaldi 12"), stato: "accettato" as const, data_preventivo: "2025-01-15" },
    { numero: "2025/002", oggetto: "Costruzione villa unifamiliare", cliente_id: cliMap.get("Famiglia Ferrari"), stato: "inviato" as const, data_preventivo: "2025-03-10" },
    { numero: "2025/003", oggetto: "Ampliamento ala nord hotel", cliente_id: cliMap.get("Hotel Belvedere S.p.A."), stato: "bozza" as const, data_preventivo: "2025-05-20" },
  ].map((p) => ({ ...p, organization_id: org }));
  const { data: prevs } = await supabase.from("preventivi").insert(preventivi).select("id, numero");

  // Voci per il primo preventivo
  const p1 = prevs?.[0];
  if (p1) {
    await supabase.from("preventivo_voci").insert([
      { organization_id: org, preventivo_id: p1.id, capitolo: "Opere murarie", categoria: "Facciata", descrizione: "Rimozione intonaco esistente", unita_misura: "mq", quantita: 350, costo_unitario: 12, ricarico_pct: 25, iva_pct: 22, ordine: 1 },
      { organization_id: org, preventivo_id: p1.id, capitolo: "Opere murarie", categoria: "Facciata", descrizione: "Nuovo intonaco a base calce", unita_misura: "mq", quantita: 350, costo_unitario: 28, ricarico_pct: 30, iva_pct: 22, ordine: 2 },
      { organization_id: org, preventivo_id: p1.id, capitolo: "Tinteggiature", categoria: "Facciata", descrizione: "Tinteggiatura silossanica 2 mani", unita_misura: "mq", quantita: 350, costo_unitario: 8, ricarico_pct: 40, iva_pct: 22, ordine: 3 },
      { organization_id: org, preventivo_id: p1.id, capitolo: "Ponteggi", categoria: "Sicurezza", descrizione: "Nolo ponteggio 90 gg", unita_misura: "mq", quantita: 420, costo_unitario: 15, ricarico_pct: 20, iva_pct: 22, ordine: 4 },
    ]);
  }

  // Commesse
  const commesse = [
    { codice: "C2025-01", denominazione: "Facciata Condominio Garibaldi", cliente_id: cliMap.get("Condominio Via Garibaldi 12"), preventivo_id: p1?.id, indirizzo_cantiere: "Via Garibaldi 12, Milano", data_inizio: "2025-04-01", data_fine_prevista: "2025-07-31", importo: 45000, budget_costi: 32000, costi_sostenuti: 18500, avanzamento_pct: 55, stato: "in_corso" as const },
    { codice: "C2025-02", denominazione: "Ristrutturazione uffici Verdi", cliente_id: cliMap.get("Immobiliare Verdi S.r.l."), indirizzo_cantiere: "Corso Vinzaglio 20, Torino", data_inizio: "2025-05-15", data_fine_prevista: "2025-09-30", importo: 78000, budget_costi: 55000, costi_sostenuti: 22000, avanzamento_pct: 30, stato: "in_corso" as const },
    { codice: "C2024-08", denominazione: "Manutenzione scuola elementare", cliente_id: cliMap.get("Comune di Bergamo"), indirizzo_cantiere: "Via Roma 5, Bergamo", data_inizio: "2024-06-01", data_fine_prevista: "2024-08-31", data_fine_effettiva: "2024-09-05", importo: 25000, budget_costi: 18000, costi_sostenuti: 18700, avanzamento_pct: 100, stato: "completata" as const },
  ].map((c) => ({ ...c, organization_id: org }));
  const { data: cants } = await supabase.from("commesse").insert(commesse).select("id, codice");

  // Rapportini
  const cantMap = new Map((cants ?? []).map((c) => [c.codice, c.id]));
  const today = new Date();
  const dstr = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const rapportini = [
    { commessa_id: cantMap.get("C2025-01"), data: dstr(0), ore: 8, lavorazione: "Montaggio ponteggio lato sud", ora_inizio: "07:30", ora_fine: "16:30" },
    { commessa_id: cantMap.get("C2025-01"), data: dstr(1), ore: 8, lavorazione: "Rimozione intonaco piano 1-2", ora_inizio: "07:30", ora_fine: "16:30" },
    { commessa_id: cantMap.get("C2025-01"), data: dstr(2), ore: 6, lavorazione: "Preparazione fondo", ora_inizio: "08:00", ora_fine: "15:00" },
    { commessa_id: cantMap.get("C2025-02"), data: dstr(0), ore: 8, lavorazione: "Demolizione tramezze uffici", ora_inizio: "08:00", ora_fine: "17:00" },
    { commessa_id: cantMap.get("C2025-02"), data: dstr(1), ore: 8, lavorazione: "Smaltimento macerie", ora_inizio: "08:00", ora_fine: "17:00" },
  ].map((r) => ({ ...r, organization_id: org, user_id: u.user!.id }));
  await supabase.from("rapportini").insert(rapportini);

  // Documenti
  const scad = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const documenti = [
    { nome: "DURC Impresa 2025", categoria: "Certificazione", data_documento: "2025-01-10", data_scadenza: scad(5), tags: ["durc", "sicurezza"] },
    { nome: "Visura camerale", categoria: "Anagrafica", data_documento: "2024-11-01", data_scadenza: scad(-20), tags: ["camera commercio"] },
    { nome: "POS Cantiere Garibaldi", categoria: "Sicurezza", commessa_id: cantMap.get("C2025-01"), data_documento: "2025-03-15", data_scadenza: scad(25), tags: ["sicurezza", "pos"] },
    { nome: "Contratto subappalto Elettro", categoria: "Contratto", commessa_id: cantMap.get("C2025-02"), data_documento: "2025-05-01", data_scadenza: scad(45), tags: ["contratto"] },
    { nome: "Assicurazione RC", categoria: "Assicurazione", data_documento: "2024-06-01", data_scadenza: scad(12), tags: ["assicurazione"] },
    { nome: "Attestato formazione ponteggi", categoria: "Formazione", data_documento: "2020-05-10", data_scadenza: scad(-50), tags: ["formazione"] },
  ].map((d) => ({ ...d, organization_id: org, uploaded_by: u.user!.id }));
  await supabase.from("documenti").insert(documenti);

  // Audit
  await supabase.from("audit_log").insert({
    organization_id: org,
    user_id: u.user.id,
    action: "seed_demo",
    entity: "system",
    metadata: { note: "Caricamento dati dimostrativi" },
  });
}
