import { TenantManagement } from "@/components/admin/tenant-management";

export default function TenantsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Tenant Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage workspaces · Super Admin access required
        </p>
      </div>
      <TenantManagement />
    </div>
  );
}
