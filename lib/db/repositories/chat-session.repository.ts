import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbChatSession, DbChatMessage } from "@/lib/db/types";

export class ChatSessionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listSessions(tenantId: string, limit = 20): Promise<DbChatSession[]> {
    const { data, error } = await this.client
      .from("chat_sessions")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`[ChatSessionRepository.listSessions] ${error.message}`);
    return (data ?? []) as DbChatSession[];
  }

  async createSession(
    tenantId: string,
    userId: string | null,
    title?: string
  ): Promise<DbChatSession> {
    const { data, error } = await this.client
      .from("chat_sessions")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        title: title ?? "New Conversation",
      })
      .select()
      .single();
    if (error) throw new Error(`[ChatSessionRepository.createSession] ${error.message}`);
    return data as DbChatSession;
  }

  async getSession(id: string, tenantId: string): Promise<DbChatSession | null> {
    const { data, error } = await this.client
      .from("chat_sessions")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .single();
    if (error) return null;
    return data as DbChatSession;
  }

  async renameSession(id: string, tenantId: string, title: string): Promise<void> {
    const { error } = await this.client
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`[ChatSessionRepository.renameSession] ${error.message}`);
  }

  async deleteSession(id: string, tenantId: string): Promise<void> {
    const { error } = await this.client
      .from("chat_sessions")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`[ChatSessionRepository.deleteSession] ${error.message}`);
  }

  async addMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string
  ): Promise<DbChatMessage> {
    const { data, error } = await this.client
      .from("chat_messages")
      .insert({ session_id: sessionId, role, content })
      .select()
      .single();
    if (error) throw new Error(`[ChatSessionRepository.addMessage] ${error.message}`);

    // Best-effort: update session timestamp (message_count derived from count)
    await this.client
      .from("chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .then(() => {});

    return data as DbChatMessage;
  }

  async getMessages(sessionId: string, tenantId: string): Promise<DbChatMessage[]> {
    // First verify session belongs to tenant
    const session = await this.getSession(sessionId, tenantId);
    if (!session) return [];

    const { data, error } = await this.client
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`[ChatSessionRepository.getMessages] ${error.message}`);
    return (data ?? []) as DbChatMessage[];
  }
}
