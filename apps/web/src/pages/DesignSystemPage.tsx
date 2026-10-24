import { useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Notice,
  SelectField,
  Spinner,
  StatusLabel,
  Table,
  TextAreaField,
  TextField,
  useToast,
} from '../components/ui';

interface SampleRow {
  id: string;
  name: string;
  state: string;
}

// Obviously illustrative layout data. It is not an agent, balance or transaction.
const SAMPLE_ROWS: SampleRow[] = [
  { id: 'a', name: 'Sample row A', state: 'Layout only' },
  { id: 'b', name: 'Sample row B', state: 'Layout only' },
];

const SWATCHES = [
  { name: 'white', className: 'bg-white' },
  { name: 'offwhite', className: 'bg-offwhite' },
  { name: 'gray-100', className: 'bg-gray-100' },
  { name: 'gray-300', className: 'bg-gray-300' },
  { name: 'gray-500', className: 'bg-gray-500' },
  { name: 'charcoal', className: 'bg-charcoal' },
  { name: 'black', className: 'bg-black' },
];

export function DesignSystemPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState('');
  const { notify } = useToast();

  const nameError =
    name.length > 0 && name.trim().length < 3 ? 'Enter at least 3 characters.' : undefined;

  return (
    <>
      <PageHeader
        title="Design system"
        description="Monochrome components used across Sentinel Wallet. Everything here is illustrative: no data on this page is real."
      />

      <div className="space-y-6">
        <Card title="Palette" description="White, off-white, grays, charcoal and black only.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {SWATCHES.map((swatch) => (
              <li key={swatch.name} className="text-xs text-gray-700">
                <div className={`h-12 rounded border border-gray-300 ${swatch.className}`} />
                <p className="mt-1">{swatch.name}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Danger (opens confirmation)
            </Button>
            <Button loading>Loading</Button>
            <Button disabledReason="Example of a control that cannot work yet.">Disabled</Button>
            <Button
              variant="secondary"
              onClick={() =>
                notify('Notification', 'Toasts announce politely and dismiss themselves.')
              }
            >
              Show notification
            </Button>
          </div>
        </Card>

        <Card
          title="Status labels"
          description="Meaning is always in the text, never in tone alone."
        >
          <div className="flex flex-wrap gap-2">
            <StatusLabel tone="solid">Solid</StatusLabel>
            <StatusLabel tone="outline">Outline</StatusLabel>
            <StatusLabel tone="muted">Muted</StatusLabel>
            <StatusLabel tone="dashed">Dashed</StatusLabel>
          </div>
        </Card>

        <Card title="Form controls">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Example name"
              hint="Validation message appears below the field."
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={nameError}
              placeholder="Type to validate"
            />
            <SelectField label="Example select" defaultValue="one">
              <option value="one">Option one</option>
              <option value="two">Option two</option>
            </SelectField>
            <div className="md:col-span-2">
              <TextAreaField label="Example notes" hint="Multi-line input." />
            </div>
          </div>
        </Card>

        <Card title="Table">
          <Table
            caption="Illustrative sample table"
            columns={[
              { key: 'name', header: 'Name', render: (row: SampleRow) => row.name },
              {
                key: 'state',
                header: 'State',
                render: (row: SampleRow) => <StatusLabel tone="muted">{row.state}</StatusLabel>,
              },
            ]}
            rows={SAMPLE_ROWS}
            rowKey={(row) => row.id}
          />
        </Card>

        <Card title="Feedback and states">
          <div className="space-y-4">
            <Notice title="Information">Neutral guidance uses a status role.</Notice>
            <Notice tone="warning" title="Caution">
              Warnings use a dashed border and a text label.
            </Notice>
            <Notice tone="error" title="Something failed">
              Errors use a heavy border and role=alert.
            </Notice>
            <Spinner label="Loading example" />
            <EmptyState
              title="Empty state"
              description="Shown when there is nothing to display yet."
            />
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title="Confirm sensitive action"
        description="Sensitive actions always require explicit confirmation. This example performs no action."
        confirmLabel="Confirm example"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          notify('Example confirmed', 'No action was performed.');
        }}
      />
    </>
  );
}
