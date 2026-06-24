import { UserManagement } from "@/components/admin/user-management";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">User Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage roles and workspace access for your tenant
        </p>
      </div>
      <UserManagement />
    </div>
  );
}
