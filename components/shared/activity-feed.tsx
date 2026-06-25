"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  FileText,
  FolderOpen,
  Layers,
  LogIn,
  Settings,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const formatDistance = (date: Date, now: Date): string => {
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
};

interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  userName?: string;
  createdAt: string;
  changes?: Record<string, unknown>;
}

interface ActivityFeedProps {
  tenantId: string;
  limit?: number;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  user_login: <LogIn className="h-4 w-4" />,
  user_logout: <LogIn className="h-4 w-4 rotate-180" />,
  scenario_create: <FileText className="h-4 w-4" />,
  scenario_delete: <FileText className="h-4 w-4" />,
  scenario_update: <FileText className="h-4 w-4" />,
  project_create: <Layers className="h-4 w-4" />,
  project_update: <Layers className="h-4 w-4" />,
  project_delete: <Layers className="h-4 w-4" />,
  account_create: <Users className="h-4 w-4" />,
  account_update: <Users className="h-4 w-4" />,
  account_delete: <Users className="h-4 w-4" />,
  user_role_change: <Users className="h-4 w-4" />,
  tenant_create: <FolderOpen className="h-4 w-4" />,
  tenant_update: <FolderOpen className="h-4 w-4" />,
  settings_update: <Settings className="h-4 w-4" />,
  data_export: <FileText className="h-4 w-4" />,
};

const ACTION_COLORS: Record<string, string> = {
  user_login: "bg-blue-500/15 text-blue-300",
  user_logout: "bg-gray-500/15 text-gray-300",
  scenario_create: "bg-green-500/15 text-green-300",
  scenario_delete: "bg-red-500/15 text-red-300",
  scenario_update: "bg-yellow-500/15 text-yellow-300",
  project_create: "bg-green-500/15 text-green-300",
  project_update: "bg-yellow-500/15 text-yellow-300",
  project_delete: "bg-red-500/15 text-red-300",
  account_create: "bg-green-500/15 text-green-300",
  account_update: "bg-yellow-500/15 text-yellow-300",
  account_delete: "bg-red-500/15 text-red-300",
  user_role_change: "bg-purple-500/15 text-purple-300",
  settings_update: "bg-cyan-500/15 text-cyan-300",
};

const getActionLabel = (action: string): string => {
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

export function ActivityFeed({ tenantId, limit = 50 }: ActivityFeedProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const params = new URLSearchParams({ limit: limit.toString() });
        const res = await fetch(`/api/audit/logs?${params}`);
        if (!res.ok) throw new Error("Failed to fetch activity");
        const data = await res.json();
        setEvents(data.events ?? []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
      } finally {
        setLoading(false);
      }
    };

    fetchActivity();
  }, [limit]);

  if (loading) {
    return (
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm">Activity Feed</CardTitle>
          <CardDescription className="text-xs">Latest tenant events</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Loading activity...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-border/40 bg-[#0d1219]/80">
        <CardHeader>
          <CardTitle className="text-sm">Activity Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-4 w-4" />
            <p>Failed to load activity</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/40 bg-[#0d1219]/80">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <CardTitle className="text-sm">Activity Feed</CardTitle>
        </div>
        <CardDescription className="text-xs">Latest {events.length} tenant events</CardDescription>
      </CardHeader>

      <CardContent>
        {events.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No activity yet
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="flex gap-3 rounded-lg border border-border/30 bg-background/20 p-3">
                {/* Icon */}
                <div className={`rounded-md p-1.5 ${ACTION_COLORS[event.action] ?? "bg-gray-500/15"}`}>
                  {ACTION_ICONS[event.action] ?? <Activity className="h-4 w-4" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-foreground">
                      {getActionLabel(event.action)}
                    </p>
                    <Badge variant="outline" className="text-[9px] border-border/40">
                      {event.resourceType}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {event.userName && <span>{event.userName}</span>}
                    {event.userName && <span>·</span>}
                    <time title={new Date(event.createdAt).toLocaleString()}>
                      {formatDistance(new Date(event.createdAt), new Date())}
                    </time>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
