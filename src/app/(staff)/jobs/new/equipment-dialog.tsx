"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { EquipmentForm } from "../../clients/[companyId]/equipment/equipment-form";
import { equipmentFormAction } from "../actions";

type FormData = Extract<Awaited<ReturnType<typeof equipmentFormAction>>, { ok: true }>["data"];

/**
 * Add an item to the client, or edit one, without leaving the new job (QA Tech,
 * Nov 2026): the same form as on the client's page, in a dialog. On save the
 * list reloads and a new item comes ticked.
 */
export function EquipmentDialog({
  companyId,
  siteId,
  equipmentId,
  onClose,
  onSaved,
}: {
  companyId: string;
  siteId: string;
  /** Null to add a new item. */
  equipmentId: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [data, setData] = useState<FormData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void equipmentFormAction(companyId, equipmentId).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [companyId, equipmentId]);

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {equipmentId ? `Edit ${data?.values?.code ?? "equipment"}` : "Add equipment or a room"}
          </DialogTitle>
          <DialogDescription>
            {equipmentId
              ? "Changes are saved to the client's equipment and used for this job's studies."
              : "Choose the type first: its usual limits, logger count and cycles are filled in. Only the ID, name, type and site are required."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-fail">
            {error}
          </p>
        ) : !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : (
          // The job form is the page's form: its submit must not see this one's.
          <div onSubmit={(e) => e.stopPropagation()}>
            <EquipmentForm
              companyId={companyId}
              companyRequalificationMonths={data.companyRequalificationMonths}
              sites={data.sites}
              departments={data.departments}
              startAt={{ siteId, departmentId: "" }}
              typeDefaults={data.typeDefaults}
              values={data.values ?? undefined}
              onSaved={onSaved}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
