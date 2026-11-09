export const TRANSPORT_MODE_LABEL: Record<string, string> = {
  ocean_fcl: 'Marítimo FCL',
  ocean_lcl: 'Marítimo LCL',
  air: 'Aéreo',
  road: 'Rodoviário',
  multimodal: 'Multimodal',
};

/** Nome do modal por extenso (nunca o código interno, ex.: "road"). */
export function transportModeLabel(mode?: string | null): string {
  if (!mode) return '';
  return TRANSPORT_MODE_LABEL[mode] || mode;
}
