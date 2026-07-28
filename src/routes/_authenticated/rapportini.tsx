import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/rapportini")({
  component: RapportiniLayout,
});

function RapportiniLayout() {
  return <Outlet />;
}