export const dashboardSections={overview:'Licznik sprzętu i statusy',incidents:'Zgłoszenia do obsługi',recentAssets:'Ostatnio przyjęte urządzenia',activity:'Ostatnia aktywność',scanner:'Skrót do skanera',shortages:'Braki magazynowe',locations:'Lokalizacje',shortcuts:'Skróty operacyjne',deliveries:'Ostatnie dostawy'} as const;
export type DashboardLayout=Record<keyof typeof dashboardSections,boolean>;
export const defaultDashboardLayout:DashboardLayout={overview:true,incidents:true,recentAssets:true,activity:true,scanner:true,shortages:true,locations:true,shortcuts:true,deliveries:true};
export interface DashboardPreference {layout:DashboardLayout;version:number}
