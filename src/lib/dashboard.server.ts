/**
 * Sprint 6 — Dashboard operativa.
 * Un'unica server function aggregata, role-aware: i dati economici sono
 * inclusi solo per i ruoli abilitati. organization_id non arriva mai dal client.
 */
import { mapServerError } from "@/lib/server-error-mapper";
import {
  costiSostenutiTotali,
  manodoperaPerCommessa,
  normalizzaPendente,
  type CostoManodoperaRow,
  type ManodoperaPendente,
} from "@/lib/costi-propagazione";

import {
  commessaAlerts,
  periodRange,
  sortByCriticita,
  auditLabel,
  isPeriodo,
  countDaApprovare,
  docScadenzaStato,
  type PeriodoKey,
} from "@/lib/dashboard-model";
import { capabilitiesFor, commesseSelect, resolveDashboardContext } from "@/lib/dashboard-authz";

function name(p: any): string {
  if (!p) return "—";
  const s = [p.nome, p.cognome].filter(Boolean).join(" ").trim();
  return s || p.email || "Utente";
}

export async function runDashboardOperativa({
  data,
  context,
}: {
  data: { periodo?: string; from?: string; to?: string };
  context: { supabase: any; userId: string };
}) {
    try {
      const { organizationId: org, roles } = await resolveDashboardContext(
        context.supabase,
        context.userId,
      );
      const {
        canViewEconomics: canEcon,
        canApprove,
        canReadAudit: canAudit,
        canReadCosti: canCosti,
      } = capabilitiesFor(roles);

      const periodo: PeriodoKey = isPeriodo(data.periodo) ? data.periodo : "30";
      const today = new Date();
      const { from, to } = periodRange(periodo, today, { from: data.from, to: data.to });
      const in30 = new Date(today);
      in30.setDate(in30.getDate() + 30);
      const in30Iso = in30.toISOString().slice(0, 10);
      const todayIso = today.toISOString().slice(0, 10);
      const in7 = new Date(today);
      in7.setDate(in7.getDate() + 7);

      const commesseSel = commesseSelect(canEcon);

      const [commQ, cantQ, prevQ, rappQ, mieiQ, docQ, attQ, auditQ] = await Promise.all([
        context.supabase
          .from("commesse")
          .select(commesseSel)
          .eq("organization_id", org)
          .is("archived_at", null),
        context.supabase
          .from("cantieri")
          .select("id, stato")
          .eq("organization_id", org)
          .is("archived_at", null),
        context.supabase
          .from("preventivi")
          .select("id, numero, oggetto, stato, data_validita, updated_at")
          .eq("organization_id", org),
        context.supabase
          .from("rapportini")
          .select("id, data, ore, stato, user_id, commessa_id, submitted_at, created_at")
          .eq("organization_id", org)
          .is("archived_at", null)
          .gte("data", from)
          .lte("data", to),
        context.supabase
          .from("rapportini")
          .select("id, data, ore, stato, commessa_id, updated_at")
          .eq("organization_id", org)
          .eq("user_id", context.userId)
          .is("archived_at", null)
          .in("stato", ["bozza", "respinto"])
          .order("data", { ascending: false })
          .limit(8),
        context.supabase
          .from("documenti")
          .select("id, nome, categoria, data_scadenza, stato")
          .eq("organization_id", org)
          .eq("upload_stato", "disponibile")
          .eq("is_versione_corrente", true)
          .is("archived_at", null)
          .not("data_scadenza", "is", null)
          .lte("data_scadenza", in30Iso)
          .order("data_scadenza")
          .limit(20),
        context.supabase
          .from("crm_attivita")
          .select("id, titolo, tipo, priorita, stato, scadenza, cliente_id")
          .eq("organization_id", org)
          .eq("stato", "pianificata")
          .not("scadenza", "is", null)
          .lte("scadenza", in7.toISOString())
          .order("scadenza")
          .limit(10),
        canAudit
          ? context.supabase
              .from("audit_log")
              .select("id, action, entity, created_at, user_id")
              .eq("organization_id", org)
              .order("created_at", { ascending: false })
              .limit(12)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const commesse = (commQ.data ?? []) as any[];
      const attive = commesse.filter((c) =>
        ["pianificata", "in_corso", "sospesa"].includes(c.stato),
      );
      const cantieri = (cantQ.data ?? []) as any[];
      const preventivi = (prevQ.data ?? []) as any[];
      const rapportini = (rappQ.data ?? []) as any[];

      // ── Commesse critiche
      const conAlerts = commesse
        .map((c) => ({
          id: c.id,
          codice: c.codice,
          denominazione: c.denominazione,
          stato: c.stato,
          avanzamento_pct: Number(c.avanzamento_pct ?? 0),
          data_fine_prevista: c.data_fine_prevista,
          responsabile_id: c.responsabile_id,
          alerts: commessaAlerts(c, today),
        }))
        .filter((c) => c.alerts.length > 0);
      const commesseCritiche = sortByCriticita(conAlerts).slice(0, 8);

      // ── Rapportini
      const daApprovare = rapportini.filter((r) => r.stato === "inviato");
      const rapportiniDaApprovareCount = countDaApprovare(rapportini);
      const orePeriodo = rapportini
        .filter(
          (r) =>
            ["approvato", "inviato", "contabilizzato"].includes(r.stato) || r.stato === "bozza",
        )
        .reduce((s, r) => s + Number(r.ore ?? 0), 0);
      const oreApprovate = rapportini
        .filter((r) => ["approvato", "contabilizzato"].includes(r.stato))
        .reduce((s, r) => s + Number(r.ore ?? 0), 0);

      const userIds = Array.from(
        new Set(
          daApprovare
            .slice(0, 8)
            .map((r) => r.user_id)
            .filter(Boolean),
        ),
      );
      const commIds = Array.from(
        new Set(
          [...daApprovare.slice(0, 8), ...((mieiQ.data ?? []) as any[])]
            .map((r) => r.commessa_id)
            .filter(Boolean),
        ),
      );
      const auditUserIds = Array.from(
        new Set(((auditQ as any).data ?? []).map((a: any) => a.user_id).filter(Boolean)),
      );
      const clienteIds = Array.from(
        new Set(((attQ.data ?? []) as any[]).map((a) => a.cliente_id).filter(Boolean)),
      );

      const [profsQ, commNamesQ, clientiQ] = await Promise.all([
        userIds.length || auditUserIds.length
          ? context.supabase
              .from("profiles")
              .select("id, nome, cognome, email")
              .in("id", Array.from(new Set([...userIds, ...auditUserIds])) as any)
          : Promise.resolve({ data: [] as any[] }),
        commIds.length
          ? context.supabase
              .from("commesse")
              .select("id, codice, denominazione")
              .in("id", commIds as any)
          : Promise.resolve({ data: [] as any[] }),
        clienteIds.length
          ? context.supabase
              .from("clienti")
              .select("id, denominazione")
              .in("id", clienteIds as any)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const pm = new Map(((profsQ.data ?? []) as any[]).map((p) => [p.id, p]));
      const cm = new Map(((commNamesQ.data ?? []) as any[]).map((c) => [c.id, c]));
      const clm = new Map(((clientiQ.data ?? []) as any[]).map((c) => [c.id, c]));

      // ── Economia (solo ruoli abilitati)
      let economia: null | {
        valoreCommesse: number;
        costiSostenuti: number;
        marginePrevisto: number;
        margineMediaPct: number | null;
        manodoperaDaContabilizzare: number | null;
        manodoperaPendente: ManodoperaPendente | null;
        manodoperaContabilizzata: number | null;
        costiExtra: {
          materiali: number;
          subappalti: number;
          totale: number;
          bolle: number;
          righeSubappalto: number;
        } | null;
      } = null;
      if (canEcon) {
        const valoreCommesse = attive.reduce(
          (s, c) => s + Number(c.ricavi_previsti ?? c.importo ?? 0),
          0,
        );
        const marginePrevisto = attive.reduce((s, c) => {
          if (c.margine_previsto !== null && c.margine_previsto !== undefined)
            return s + Number(c.margine_previsto);
          const r = Number(c.ricavi_previsti ?? c.importo ?? 0);
          const cp = Number(c.costi_previsti ?? c.budget_costi ?? 0);
          return s + (r - cp);
        }, 0);

        let manodoperaDaContabilizzare: number | null = null;
        let manodoperaPendente: ManodoperaPendente | null = null;
        let manodoperaContabilizzata: number | null = null;
        let costiSostenuti = attive.reduce((s, c) => s + Number(c.costi_sostenuti ?? 0), 0);
        let costiExtra: {
          materiali: number;
          subappalti: number;
          totale: number;
          bolle: number;
          righeSubappalto: number;
        } | null = null;

        if (canCosti) {
          const ids = attive.map((c) => c.id);
          const [pendQ, costiQ, extraQ] = await Promise.all([
            context.supabase.rpc("get_kpi_manodopera_pendente"),
            ids.length
              ? context.supabase.rpc("get_costi_manodopera", { _commessa_ids: ids })
              : Promise.resolve({ data: [] as any[] }),
            context.supabase.rpc("get_costi_extra_periodo", { _from: from, _to: to }),
          ]);
          manodoperaPendente = normalizzaPendente((pendQ as any).data);
          manodoperaDaContabilizzare = manodoperaPendente.righe;
          const rows = ((costiQ as any).data ?? []) as CostoManodoperaRow[];
          manodoperaContabilizzata = Object.values(manodoperaPerCommessa(rows)).reduce(
            (s, v) => s + v,
            0,
          );
          costiSostenuti = costiSostenutiTotali(attive, rows);

          const ex = (extraQ as any).data as any;
          if (ex?.visibile) {
            costiExtra = {
              materiali: Number(ex.materiali ?? 0),
              subappalti: Number(ex.subappalti ?? 0),
              totale: Number(ex.totale ?? 0),
              bolle: Number(ex.bolle ?? 0),
              righeSubappalto: Number(ex.righe_subappalto ?? 0),
            };
          }
        }

        economia = {
          valoreCommesse,
          costiSostenuti,
          marginePrevisto,
          margineMediaPct: valoreCommesse > 0 ? (marginePrevisto / valoreCommesse) * 100 : null,
          manodoperaDaContabilizzare,
          manodoperaPendente,
          manodoperaContabilizzata,
          costiExtra,
        };
      }


      const docs = (docQ.data ?? []) as any[];
      const docsScaduti = docs.filter(
        (d) => docScadenzaStato(d.data_scadenza, today) === "scaduto",
      );

      return {
        periodo,
        range: { from, to },
        capabilities: { canViewEconomics: canEcon, canApprove, canReadAudit: canAudit },
        kpi: {
          commesseAttive: attive.length,
          commesseInCorso: commesse.filter((c) => c.stato === "in_corso").length,
          commesseCritiche: conAlerts.length,
          cantieriAttivi: cantieri.filter((k) =>
            ["in_corso", "attivo", "aperto"].includes(String(k.stato)),
          ).length,
          preventiviAperti: preventivi.filter((p) =>
            ["bozza", "inviato", "in_revisione", "pronto"].includes(p.stato),
          ).length,
          rapportiniDaApprovare: rapportiniDaApprovareCount,
          orePeriodo,
          oreApprovate,
          documentiInScadenza: docs.length - docsScaduti.length,
          documentiScaduti: docsScaduti.length,
        },
        economia,
        commesseCritiche,
        rapportiniDaApprovare: daApprovare
          .sort((a, b) => String(b.data).localeCompare(String(a.data)))
          .slice(0, 8)
          .map((r) => ({
            id: r.id,
            data: r.data,
            ore: Number(r.ore ?? 0),
            autore: name(pm.get(r.user_id)),
            commessa: cm.get(r.commessa_id) ?? null,
          })),
        mieiRapportini: ((mieiQ.data ?? []) as any[]).map((r) => ({
          id: r.id,
          data: r.data,
          ore: Number(r.ore ?? 0),
          stato: r.stato,
          commessa: cm.get(r.commessa_id) ?? null,
        })),
        documenti: docs.slice(0, 8).map((d) => ({
          id: d.id,
          nome: d.nome,
          categoria: d.categoria,
          data_scadenza: d.data_scadenza,
          scaduto: String(d.data_scadenza).slice(0, 10) < todayIso,
        })),
        attivita: ((attQ.data ?? []) as any[]).map((a) => ({
          id: a.id,
          titolo: a.titolo,
          tipo: a.tipo,
          priorita: a.priorita,
          scadenza: a.scadenza,
          cliente: clm.get(a.cliente_id) ?? null,
          cliente_id: a.cliente_id,
        })),
        attivitaRecenti: (((auditQ as any).data ?? []) as any[]).map((a) => ({
          id: a.id,
          label: auditLabel(a.action),
          entity: a.entity,
          created_at: a.created_at,
          autore: a.user_id ? name(pm.get(a.user_id)) : "Sistema",
        })),
        isEmpty: commesse.length === 0 && preventivi.length === 0 && rapportini.length === 0,
      };
    } catch (e) {
      throw new Error(mapServerError(e));
    }
}
