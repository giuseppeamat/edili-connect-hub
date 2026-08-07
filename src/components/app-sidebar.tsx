import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Truck,
  FileText,
  HardHat,
  ClipboardList,
  FolderOpen,
  CalendarClock,
  Shield,
  Building2,
  Wallet,
  Package,
  Hammer,
  Bell,
  PiggyBank,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { useCurrentUser, type AppRole } from "@/hooks/use-current-user";

type NavItem = { title: string; url: string; icon: any; hideForRoles?: AppRole[]; onlyForRoles?: AppRole[] };

const items: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clienti", url: "/clienti", icon: Users, hideForRoles: ["operaio", "cliente", "fornitore"] },
  { title: "Fornitori", url: "/fornitori", icon: Truck, hideForRoles: ["operaio", "cliente", "fornitore"] },
  { title: "Subappaltatori", url: "/subappaltatori", icon: Hammer, hideForRoles: ["operaio", "cliente", "fornitore"] },
  { title: "Preventivi", url: "/preventivi", icon: FileText, hideForRoles: ["operaio", "cliente", "fornitore"] },
  { title: "Commesse", url: "/commesse", icon: HardHat },
  { title: "Rapportini", url: "/rapportini", icon: ClipboardList },
  { title: "Costi personale", url: "/costi-personale", icon: Wallet, onlyForRoles: ["proprietario", "amministratore", "amministrazione"] },
  { title: "Costi struttura", url: "/costi-struttura", icon: PiggyBank, onlyForRoles: ["proprietario", "amministratore", "amministrazione"] },
  { title: "Materiali e prezzi", url: "/materiali", icon: Package, hideForRoles: ["operaio", "cliente", "fornitore"] },
  { title: "Documenti", url: "/documenti", icon: FolderOpen },
  { title: "Notifiche", url: "/notifiche", icon: Bell },
  { title: "Scadenziario", url: "/scadenziario", icon: CalendarClock },
  { title: "Organizzazione", url: "/organizzazione", icon: Building2 },
  { title: "Audit", url: "/audit", icon: Shield },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { roles } = useCurrentUser();
  const isActive = (u: string) => (u === "/" ? currentPath === "/" : currentPath.startsWith(u));
  const visible = items.filter((it) => {
    if (it.hideForRoles?.some((r) => roles.includes(r))) return false;
    if (it.onlyForRoles && !it.onlyForRoles.some((r) => roles.includes(r))) return false;
    return true;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-sidebar-primary p-1.5 shrink-0">
            <HardHat className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <span className="font-bold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            CantiereOS
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestione</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
