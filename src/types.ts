export type Machine = {
    ip: string;
    isUsed: boolean;
    assignedProject?: string | undefined;
    instanceId?: string | undefined;
}