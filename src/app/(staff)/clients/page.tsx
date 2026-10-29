import { Building2, FileSpreadsheet, Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db/client";
import { can } from "@/domain/auth/permissions";
import { listCompanies } from "@/domain/clients/queries";
import { requirePermission } from "@/lib/auth/dal";

import { AddClientButton } from "./client-dialogs";
import { DueBadge } from "./due-badge";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const actor = await requirePermission("clients.view");
  const canManage = can(actor, "clients.manage");
  const { q } = await searchParams;
  const search = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const companies = await listCompanies(db, actor, search);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Clients"
        description="Client companies, their sites and departments, and the equipment QA Tech maps and validates."
        action={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" asChild>
                <Link href="/clients/import">
                  <FileSpreadsheet aria-hidden="true" />
                  Import from Excel
                </Link>
              </Button>
              <AddClientButton />
            </div>
          ) : undefined
        }
      />

      <form role="search" className="flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">
          Search clients
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Client, site or equipment ID"
        />
        <Button type="submit" variant="secondary">
          <Search aria-hidden="true" />
          Search
        </Button>
      </form>

      {companies.length === 0 ? (
        search ? (
          <EmptyState
            icon={Search}
            title={`No client matches “${search}”`}
            description="Try part of the company name, a site, or an equipment ID such as BE-WF-02."
            action={
              <Button variant="secondary" asChild>
                <Link href="/clients">Show all clients</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Building2}
            title="No clients yet"
            description={
              canManage
                ? "Add your first client, or import clients and equipment from an Excel sheet."
                : "Clients appear here once a manager adds them."
            }
            action={canManage ? <AddClientButton /> : undefined}
          />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Sites</TableHead>
              <TableHead className="text-right">Equipment</TableHead>
              <TableHead>Next study due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((company) => (
              <TableRow key={company.id}>
                <TableCell>
                  <Link
                    href={`/clients/${company.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {company.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {company.code}
                    {company.active ? null : (
                      <StatusBadge tone="neutral" className="ml-2">
                        Inactive
                      </StatusBadge>
                    )}
                  </p>
                </TableCell>
                <TableCell className="tabular text-right">{company.siteCount}</TableCell>
                <TableCell className="tabular text-right">{company.equipmentCount}</TableCell>
                <TableCell>
                  <DueBadge nextDue={company.nextDue} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
