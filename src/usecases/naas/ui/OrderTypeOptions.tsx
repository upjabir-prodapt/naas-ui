import type { OptionListItem, OptionListResult } from '../types';
import { IndexedListPicker, type IndexedListPickerColumn, text } from '@aicoe/aihub-platform/ui';

// Description can run to a full sentence ("Ethernet virtual line — the
// same source/destination port can support multiple lines, tagged by
// VLAN."), so it wraps rather than ellipsing, and takes the wider share
// of the row — same treatment PortSearch gives building/site names.
const COLUMNS: IndexedListPickerColumn<OptionListItem>[] = [
  { label: 'Option', render: (row) => text(row.label), width: '1fr' },
  {
    label: 'Description',
    render: (row) => (row.description ? text(row.description) : '—'),
    wrap: true,
    width: '2fr',
  },
];

// Rendered by chatExtras.tsx for whichever turn called
// present_order_type_options (Routing's "what would you like to order?"
// menu) or present_connection_framework_options (the EPL/EVPL choice
// that follows picking "Ethernet Connection"). Both tools return the
// same OptionListResult shape, so this one component serves both — the
// label text is the only thing that differs between them and it comes
// from the data, not from here. Same clickable-picker treatment as every
// other list-tool, built on the shared IndexedListPicker.
export default function OrderTypeOptions({
  result,
  onSelect,
}: {
  result: OptionListResult;
  onSelect: (text: string) => void;
}) {
  // Defense in depth: same reasoning as RecommendationOptions.tsx — a
  // malformed result (e.g. an uncaught backend exception surfacing as
  // something other than the expected shape) must not crash the chat.
  const options = Array.isArray(result.options) ? result.options : [];

  return (
    <IndexedListPicker
      rows={options}
      columns={COLUMNS}
      onSelect={onSelect}
      selectMessage={(row) => `I'll go with #${row.index}: ${row.label}.`}
      emptyMessage="No options available."
    />
  );
}
