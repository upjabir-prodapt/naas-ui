import type { ListBuildingSitesResult, PortSiteCandidate } from '../types';
import { IndexedListPicker } from '@aicoe/aihub-platform/ui';

const COLUMNS = [
  {
    label: 'Bandwidth',
    render: (row: PortSiteCandidate) => row.bandwidth,
    width: '1fr',
  },
];

// Rendered by NaasChatPanel (via chatExtras.tsx) for list_building_sites
// — Ethernet Port's bandwidth-selection step, once a building is picked.
// Every row here is already a real, orderable capacity slot
// (mcp-server/tools/building.py filters to `port_available` entries
// before returning), so unlike the standard-tier picker
// (BandwidthOptions.tsx) there's no separate "is this actually available"
// question — clicking a row is picking a real product outright. Same
// clickable-picker treatment as every other list-tool, built on the
// shared IndexedListPicker.
export default function PortSiteOptions({
  result,
  onSelect,
}: {
  result: ListBuildingSitesResult;
  onSelect: (text: string) => void;
}) {
  const sites = Array.isArray(result.sites) ? result.sites : [];

  return (
    <IndexedListPicker
      rows={sites}
      columns={COLUMNS}
      onSelect={onSelect}
      selectMessage={(row) => `I'll go with #${row.index}: ${row.bandwidth}.`}
      emptyMessage="No available capacity at this building."
    />
  );
}
