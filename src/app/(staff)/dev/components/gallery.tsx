"use client";

import { FileSpreadsheet, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FileDrop } from "@/components/ui/file-drop";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Stepper } from "@/components/ui/stepper";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Real values from report Watson/Seawoods/05/26/Cold Storage (Walk In Freezer)/BE-WF-02.
const sensorRows = [
  { position: "L-01", serial: "62281257", min: -22.9, max: -17.9, avg: -21.0 },
  { position: "L-04", serial: "62220170", min: -23.0, max: -20.0, avg: -21.9, note: "Cold point" },
  { position: "L-05", serial: "62283645", min: -17.6, max: -15.0, avg: -16.7, note: "Hot point" },
  { position: "L-09", serial: "62283563", min: -22.9, max: -18.7, avg: -21.3 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ComponentGallery() {
  const [droppedFile, setDroppedFile] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus aria-hidden="true" />
            Create job
          </Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Void study</Button>
          <Button variant="link">View certificate</Button>
          <Button size="lg">Start mapping</Button>
          <Button disabled>Send for check</Button>
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="pass">Within limits</StatusBadge>
          <StatusBadge tone="attention">Calibration due in 12 days</StatusBadge>
          <StatusBadge tone="fail">Post-cal failed</StatusBadge>
          <StatusBadge tone="info">Sent to client</StatusBadge>
          <StatusBadge tone="neutral">Draft</StatusBadge>
        </div>
      </Section>

      <Section title="Study progress">
        <Stepper
          steps={[
            { id: "details", label: "Details", state: "done" },
            { id: "sensors", label: "Sensors", state: "done" },
            {
              id: "data",
              label: "Raw data",
              state: "attention",
              note: "Logger 62283645 has no readings after 14:20",
            },
            { id: "review", label: "Review", state: "upcoming" },
            { id: "report", label: "Report", state: "upcoming" },
            { id: "sign", label: "Sign-off", state: "locked", note: "Needs a checked report" },
          ]}
        />
      </Section>

      <Section title="Form controls">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="equipment-id"
            label="Equipment ID"
            hint="As written on the client's asset tag."
            required
          >
            <Input id="equipment-id" defaultValue="BE-WF-02" aria-describedby="equipment-id-desc" />
          </Field>
          <Field id="set-point" label="Set point (°C)" error="Enter a number, for example -24.">
            <Input
              id="set-point"
              defaultValue="minus 24"
              aria-invalid
              aria-describedby="set-point-desc"
            />
          </Field>
          <Field id="equipment-type" label="Equipment type">
            <Select defaultValue="walk-in-freezer">
              <SelectTrigger id="equipment-type">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="walk-in-freezer">Walk-in freezer</SelectItem>
                <SelectItem value="deep-freezer">Deep freezer</SelectItem>
                <SelectItem value="cold-room">Cold room</SelectItem>
                <SelectItem value="warehouse">Warehouse</SelectItem>
                <SelectItem value="autoclave">Autoclave</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="remarks" label="Remarks">
            <Textarea id="remarks" placeholder="Anything the checker should know" />
          </Field>
        </div>
      </Section>

      <Section title="Readings table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Position</TableHead>
              <TableHead>Logger serial</TableHead>
              <TableHead className="text-right">Min (°C)</TableHead>
              <TableHead className="text-right">Max (°C)</TableHead>
              <TableHead className="text-right">Average (°C)</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sensorRows.map((row) => (
              <TableRow key={row.position}>
                <TableCell className="font-medium">{row.position}</TableCell>
                <TableCell>{row.serial}</TableCell>
                <TableCell className="text-right">{row.min.toFixed(1)}</TableCell>
                <TableCell className="text-right">{row.max.toFixed(1)}</TableCell>
                <TableCell className="text-right">{row.avg.toFixed(1)}</TableCell>
                <TableCell>
                  {row.note ? (
                    // Hot/cold point is a finding, not a pass/fail status, so it stays neutral.
                    <StatusBadge tone="neutral">{row.note}</StatusBadge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Upload">
        <FileDrop
          accept=".xlsx,.xls,.csv"
          description="Logger export (.xlsx, .xls or .csv)"
          maxSizeMb={50}
          onFile={(file) => setDroppedFile(file.name)}
        />
        {droppedFile ? (
          <p className="text-sm text-muted-foreground">Selected: {droppedFile}</p>
        ) : null}
      </Section>

      <Section title="Dialog">
        <Dialog>
          <div>
            <DialogTrigger asChild>
              <Button variant="danger">Void study</Button>
            </DialogTrigger>
          </div>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Void study BE-WF-02?</DialogTitle>
              <DialogDescription>
                The study stays in the audit trail but can no longer be reported. Give a reason.
              </DialogDescription>
            </DialogHeader>
            <Field id="void-reason" label="Reason" required>
              <Textarea
                id="void-reason"
                placeholder="e.g. Post-cal failed, client chose to repeat"
              />
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Keep study</Button>
              </DialogClose>
              <Button variant="danger">Void study</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <EmptyState
        icon={FileSpreadsheet}
        title="No raw data yet"
        description="Upload the logger export for this cycle. The original file is kept exactly as uploaded."
        action={<Button>Upload raw data</Button>}
      />
    </div>
  );
}
