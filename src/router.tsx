import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * Errori applicativi "definitivi": nessun retry ha senso (conflitti di
 * concorrenza, permessi, validazione, risorsa mancante). Ritentarli genera
 * solo carico CPU sul database senza mai riuscire.
 */
const NON_RETRIABLE =
  /modificato da un altro utente|conflitto di concorrenza|non hai i permessi|non autorizzat|unauthorized|forbidden|non trovat|obbligatori|non valid/i;

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Evita refetch a raffica quando più componenti montano la stessa query.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) =>
          failureCount < 1 && !NON_RETRIABLE.test(String((error as Error)?.message ?? "")),
      },
      mutations: {
        // Una mutazione fallita non va mai ritentata in automatico.
        retry: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
