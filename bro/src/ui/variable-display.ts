export function formatColorVariableDisplayName(name: string | null | undefined): string {
    if (typeof name !== 'string') return '';
    const trimmed = name.trim();
    if (!trimmed) return '';
    const matched = trimmed.match(/^[^/]+\/color\/(.+)$/);
    if (matched && matched[1]) return matched[1];
    return trimmed;
}

