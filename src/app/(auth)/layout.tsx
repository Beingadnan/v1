import Image from "next/image";
import type { ReactNode } from "react";

/** Centered card for sign-in and set-password pages, with the navy scale band on the left. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-[38%] max-w-md flex-col justify-between bg-brand scale-ticks p-10 text-white lg:flex">
        <div className="w-fit rounded-md bg-white px-3 py-2">
          <Image
            src="/brand/qatech-logo.png"
            alt="QA Tech"
            width={245}
            height={119}
            className="h-12 w-auto"
            priority
          />
        </div>
        <div>
          <p className="text-2xl leading-snug font-semibold">
            Mapping, calibration and validation records in one place.
          </p>
          <p className="mt-3 text-sm text-white/75">
            Jobs, raw data, reports and signatures — traceable from the field to the client.
          </p>
        </div>
        <p className="text-xs text-white/60">QA Tech · A division of GMP Technical Solutions</p>
      </div>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Image
              src="/brand/qatech-logo.png"
              alt="QA Tech"
              width={245}
              height={119}
              className="h-12 w-auto"
              priority
            />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
