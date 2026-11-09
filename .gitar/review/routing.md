# Routing rules

Navcon computes walking routes on the phone from the venue's obstacles (`src/routing/`). The rules below came from the owner's review of real routes. Each one is covered by a check in `tests/routing.test.ts`. Flag any change that breaks a rule, and any change that weakens the check that covers it.

## Routes never cross an obstacle

A route never crosses a booth, a service area or the hall outline. Flag changes to how obstacles are subtracted from the hall or grown by the clearance margin in `src/routing/grid.ts` unless the pull request explains them.

## Routes keep their profile's clearance

Standard and no stairs keep 0.3 m from every obstacle. Wheelchair keeps 0.5 m. These values live in `MARGIN` in `src/routing/grid.ts`. Flag any change that lowers them, and any change that lets the wheelchair profile use a gap the margin would exclude.

## Routes run down the middle of aisles

Cells near walls cost more, so a route keeps to the middle of its aisle instead of hugging a booth edge. Flag changes that remove or flatten the per-cell wall cost.

## Routes turn only in 45 degree steps

Turns are square where booths stand square (Halls 1 to 5). Legs run at 45 degrees where booths are turned 45 degrees (Halls A to C). Purely orthogonal routing would be wrong in Halls A to C, and no other angle is allowed anywhere. A change to `TURN`, `OFF_AXIS` or `H_WEIGHT` in `src/routing/astar.ts` needs a stated reason in the pull request.

## Doors first, otherwise the side that suits the trip

A place with doors is always entered and left through a door, even if another side is nearer. A place without doors can be reached from any side: the search picks the side that suits the trip and skips cramped gaps behind the place. The access rules live in `src/routing/route.ts`.

## Every place stays reachable under every profile

A change must not leave any booth, area or point without a walkable access point under standard, no stairs or wheelchair.

## Routing stays on the device

Routing must keep working with no signal after the first load. Flag any network call, or any import of a network-dependent module, inside `src/routing/`.

## A failing routing check is fixed in the routing code

Never make a failing check pass by skipping it, deleting it, or loosening its tolerance. Fix the code under `src/routing/`. If the rule itself has changed, the pull request must say so and the owner must agree.

## Route speed

The test run asserts that a route across the whole venue is computed in less than one second. Flag changes that add work inside the A* inner loop without a measured reason.
