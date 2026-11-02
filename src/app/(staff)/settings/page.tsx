import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db/client";
import { getSettings } from "@/domain/admin/queries";
import { can } from "@/domain/auth/permissions";
import { getEffectiveTypeDefaults } from "@/domain/clients/type-defaults-service";
import { requirePermission } from "@/lib/auth/dal";

import { CalculationsForm, DetailsForm, NumberFormatsForm, SitesSection } from "./settings-forms";
import { LetterheadForm } from "./letterhead-form";
import { TypeDefaultsSection } from "./type-defaults";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requirePermission("settings.view");
  const canEdit = can(actor, "settings.manage");
  const { settings, sites } = await getSettings(db, actor);
  const typeDefaults = await getEffectiveTypeDefaults(db, actor.organisationId);

  if (!settings) {
    return (
      <p className="text-sm text-fail">
        Settings are missing for this organisation. Run <code>npm run db:seed</code> on the server.
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description={
          canEdit
            ? "Changes are saved per section and recorded in the audit trail."
            : "You can view these settings. Only admins can change them."
        }
      />
      <DetailsForm
        canEdit={canEdit}
        values={{
          legalName: settings.legalName,
          shortName: settings.shortName,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
          website: settings.website,
          gstin: settings.gstin,
          udyamNumber: settings.udyamNumber,
        }}
      />
      <LetterheadForm hasImage={settings.letterheadFileId !== null} canEdit={canEdit} />
      <SitesSection
        canEdit={canEdit}
        sites={sites.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          address: s.address,
          active: s.active,
        }))}
      />
      <NumberFormatsForm
        canEdit={canEdit}
        values={{
          jobNumberFormat: settings.jobNumberFormat,
          certificateNumberFormat: settings.certificateNumberFormat,
        }}
      />
      <TypeDefaultsSection canEdit={canEdit} defaults={typeDefaults} />
      <CalculationsForm
        canEdit={canEdit}
        values={{
          mktActivationEnergyKjMol: settings.mktActivationEnergyKjMol,
          f0ReferenceTempC: settings.f0ReferenceTempC,
          f0ZValueC: settings.f0ZValueC,
          sessionIdleMinutes: settings.sessionIdleMinutes,
        }}
      />
    </div>
  );
}
