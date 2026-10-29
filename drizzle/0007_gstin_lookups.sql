CREATE TABLE "gstin_lookups" (
	"organisation_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"details" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gstin_lookups_organisation_id_gstin_pk" PRIMARY KEY("organisation_id","gstin")
);
--> statement-breakpoint
ALTER TABLE "gstin_lookups" ADD CONSTRAINT "gstin_lookups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;