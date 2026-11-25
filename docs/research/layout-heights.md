# Layout: extreme top and measured heights (Nov 2026)

## What QA Tech asked

A refrigerator's layout had only Bottom, Middle and Top. QA Tech also maps an
**extreme top** position: under the ceiling of the chamber, above the top
shelf. They also want to write down **how far** each logger sat from the
bottom or the top ("5 cm from top"), and have the drawing follow that height.

## Findings

- WHO TRS 961 Annex 9, Supplement 8 (temperature mapping of storage areas)
  asks for sensors at low, middle and high points. The high sensor goes at the
  highest point where product can be stored. Warm air collects under the
  ceiling, so a sensor above the top shelf shows the worst case.
  <https://www.who.int/publications/m/item/Annex-9-g-trs-961>
- Vendors' guidance ties each level to product heights, not to fixed metres:
  bottom at the lowest storage point, top at the highest, middle halfway.
  It gives no centimetre figures, so the distance has to be measured on site
  and recorded with the position.
  <https://eupry.com/temperature-mapping/data-logger-placement/>
- Vaisala's sensor-placement Q&A says the same: record where each sensor
  actually was, so a requalification can put it back in the same spot.
  <https://vaisala.com/en/comment/93506>

## What was built

- A fourth level for boxes, **Extreme top**. It is drawn dark green on the
  diagram and listed first in the report's elevation distribution.
- Each position can record its height in **cm from the bottom or from the top**.
  - When the equipment's height is known, the height places the logger
    exactly on the drawing. For example, 5 cm from the top of a 240 cm box is
    at 0.979 of the height.
  - A height taller than the box is refused.
  - When the box's height isn't recorded, the measured height is still printed,
    and the screen asks for the box's height.
- The report's "Elevation Plane" column prints the measured height, for
  example "Extreme top (5 cm from top)". Without a measured height it prints
  the computed one, as before ("Top (2.2 m)").
- The position's description gains the measured height, for example
  "Extreme top front left corner, 5 cm from top".
- A requalification that copies the last study's layout keeps the levels and
  heights.
