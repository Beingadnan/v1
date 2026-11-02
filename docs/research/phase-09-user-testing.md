# Phase 9 user testing: review and sign-off

Tested on 2 Nov 2026, on the production build.

**Data**

- **QA Tech's BE-WF-02 export**, through the whole flow, in the integration test
  `review.test.ts` (12 tests, three organisations):
  - **the app route:** Rev 00, back from the checker, Done By and Checked By,
    released, returned by the client, then Rev 01, Reviewed By and Approved By;
  - **the paper route;**
  - **a deviation the client's QA head decides.**
- **Seeded FE-WF-05, in the browser test** `report.spec.ts`: drafted, signed four
  times by four people, released, and approved on a phone (Pixel 7).

**Roles:** report preparer, team leader, manager, client QA, client QA head, a QA head
of another client company, and accounts. **Interruptions:** a wrong password, two
checkers at once, a session that ends while signing, and the client returning a
report after QA Tech released it.

Everything below was fixed and has a test unless marked **open**.

## The exit test

1. **Rev 00 to the checker:** the preparer signs Done By. A wrong password signs
   nothing; it is audited and counts toward the lockout. The checker returns it with a
   comment on "Equipment & mapping details, page 3".
2. **Back to Checked:** the preparer answers the comment ("Fixed: …") and signs Done By
   again. A new PDF and a new hash. The manager signs Checked By.
3. **Released:** to the client's QA and QA head, with the email text ready to send. The
   job moves to Sent to client.
4. **The client returns Rev 00** with a comment on the conclusion. The job moves to
   Rework.
5. **Rev 01:** the preparer starts it with a reason. Freezing waits until the client's
   comment is answered. It is checked and released; the client's QA signs Reviewed By
   and the QA head signs Approved By.
6. **The result:**
   - **The report:** Rev 01 is Signed. The issued copy is stored with its own SHA-256;
     it is pages 1–12 of the frozen PDF plus the signature page.
   - **The job and the study:** the job is Client signed, and the study is in the
     archive.
   - **Rev 00:** superseded, but its frozen PDF and its signed copy still download. The
     signed copy shows Rev 00's own signatures, and building it twice gives the same
     bytes.
7. **A second job closes on paper:** checked, then the scan and the four names and
   dates. The job is Client signed, and the scan downloads with its hash.

The issued copy was checked by eye:

- **Page 6:** "Signed electronically" with the time (IST), and the name in capitals in
  each of the four boxes.
- **The last page:** the four signatures with roles, organisations, times, the frozen
  PDF's SHA-256 and the signature ids.

## What broke, and the fix

| Found                                                                                                                                                                                                                       | Fix                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **After signing, the page said nothing.** The server action's reply re-draws the page at once. Once the step was done, the sign button and its dialog were gone before they could pass "Signed …" up, so no message showed. | The dialog tells the page as soon as the action returns, before anything is re-drawn. The browser test now checks the message after Approved By.                                                    |
| The signature table's "Role and organisation" cut the client's company name short.                                                                                                                                          | The role and the organisation are on two lines.                                                                                                                                                     |
| The phase 8 test picked a certificate by number only. With three test organisations holding PDL-77, it got another organisation's.                                                                                          | The test looks it up within its own organisation. (The app's own queries already do.)                                                                                                               |
| Admin had every action, so an admin could have signed Reviewed By for the client.                                                                                                                                           | Client actions (review, approve, decide a deviation) belong to client roles only. The permission test checks it.                                                                                    |
| The names were printed into the frozen PDF when it was frozen, so a later signer's name could never appear on it without changing the file.                                                                                 | The frozen PDF keeps the boxes empty. Names and times are stamped into the copy that is handed out, from the signatures, at the positions recorded at freeze. The frozen file stays byte-identical. |

## Two people, one record

- **Two checkers sign Checked By together:** the revision is locked while one signs.
  The second is told "Checking it isn't possible: Rev 00 is checked."
- **A reviewer tries to approve too:** "You signed Reviewed By on this revision.
  Another person signs Approved By."
- **A preparer who is also a team leader** can't check their own report. The Reviews
  page marks it "you prepared it: another checker signs".
- **The session ends while the dialog is open:** the action returns "You were signed
  out…", and nothing is signed.

## Roles

| Role                          | What happened                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Report preparer               | Answers comments and signs Done By. Can't check, release or sign for the client.                                                           |
| Team leader, manager          | Sign Checked By (never on their own Done By), return with comments, release, and record a paper sign-off. The Reviews page is their queue. |
| Client QA                     | Sees only their company's released revisions. Signs Reviewed By or sends the report back. Can't approve.                                   |
| Client QA head                | Signs Approved By (not on a revision they reviewed). Decides deviations with a signed decision, from their home page.                      |
| Another company's QA head     | Gets "That report does not exist." and a 404 on the PDF.                                                                                   |
| Accounts, field engineer, lab | See reports, no buttons.                                                                                                                   |

## Phone

The client QA head approved Rev 00 on a Pixel 7:

- the "Open Rev 00 to read it" link opens the phone's PDF viewer;
- the password dialog fits the screen;
- "Signed reports (1)" shows on their home page afterwards.

## Open

- **Email:** Release opens the person's own email with the text and link ready.
  Automatic email is phase 11 (notifications).
- **Ashraf's sign-off on the look** of the signature page and the stamped boxes.
- **Real client users on Neon:** add Watson's QA and QA head from the client's page,
  then release a real report.
