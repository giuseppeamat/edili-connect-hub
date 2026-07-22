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

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Clienti", url: "/clienti", icon: Users },
  { title: "Fornitori", url: "/fornitori", icon: Truck },
  { title: "Preventivi", url: "/preventivi", icon: FileText },
  { title: "Commesse", url: "/commesse", icon: HardHat },
  { title: "Rapportini", url: "/rapportini", icon: ClipboardList },
  { title: "Documenti", url: "/documenti", icon: FolderOpen },
  { title: "Scadenziario", url: "/scadenziario", icon: CalendarClock },
  { title: "Audit", url: "/audit", icon: Shield },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (u: string) => (u === "/" ? currentPath === "/" : currentPath.startsWith(u));

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
              {items.map((item) => (
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
