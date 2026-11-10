// AI Assistance Disclosure: ChatGPT (GPT-6), 2026-09-30.
// Scope: Shared user type including display names and account verification. Author review: Pending.
export interface User {
    id: number,
    name: string,
    displayName: string,
    email: string,
    role: string,
    verificationStatus: "pending_verification" | "verified",
    verificationCode?: string | null
}