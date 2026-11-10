/* Tests for portfolio-core.js - the date maths, ordering and filters behind
   #/portfolio. Run with: node admin/portfolio-core.test.js */

const assert = require("node:assert/strict");
const Core = require("../portfolio-core.js");

let passed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed += 1;
    } catch (error) {
        failures.push({ name, error });
    }
}

const NOW = new Date("2026-11-10T09:00:00Z");

/* ------------------------------------------------------------------- dates */

test("an update today reads as today", () => {
    assert.equal(Core.timeAgo("2026-11-10", NOW), "today");
});

test("a future date is treated as today, never a negative age", () => {
    assert.equal(Core.timeAgo("2027-03-01", NOW), "today");
    assert.equal(Core.daysSince("2027-03-01", NOW), 0);
});

test("yesterday and a handful of days read in days", () => {
    assert.equal(Core.timeAgo("2026-11-09", NOW), "1 day ago");
    assert.equal(Core.timeAgo("2026-11-06", NOW), "4 days ago");
    assert.equal(Core.timeAgo("2026-10-12", NOW), "29 days ago");
});

test("past a month it rolls into months", () => {
    assert.equal(Core.timeAgo("2026-10-11", NOW), "1 month ago");
    assert.equal(Core.timeAgo("2026-09-01", NOW), "2 months ago");
    assert.equal(Core.timeAgo("2025-12-15", NOW), "11 months ago");
});

test("past a year it rolls into years", () => {
    assert.equal(Core.timeAgo("2025-11-10", NOW), "1 year ago");
    assert.equal(Core.timeAgo("2024-10-01", NOW), "2 years ago");
});

test("a full timestamp works as well as a plain day", () => {
    assert.equal(Core.timeAgo("2026-11-08T23:30:00Z", NOW), "2 days ago");
});

test("a missing or broken date has no age at all", () => {
    assert.equal(Core.timeAgo("", NOW), "");
    assert.equal(Core.timeAgo(null, NOW), "");
    assert.equal(Core.timeAgo("not a date", NOW), "");
    assert.equal(Core.daysSince("not a date", NOW), null);
});

/* --------------------------------------------------------------- ordering */

test("normalise drops entries without a title and keeps the rest", () => {
    const list = Core.normalise({
        projects: [
            { title: "  Real project  ", updated: "2026-11-06" },
            { title: "   ", updated: "2026-11-01" },
            { blurb: "no title" },
            null
        ]
    }, NOW);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Real project");
});

test("normalise accepts a bare array as well as a document", () => {
    assert.equal(Core.normalise([{ title: "A" }], NOW).length, 1);
    assert.equal(Core.normalise({ projects: [{ title: "A" }] }, NOW).length, 1);
    assert.deepEqual(Core.normalise(null, NOW), []);
});

test("active work sorts above archived work, newest first inside each group", () => {
    const list = Core.normalise({
        projects: [
            { title: "Old active", updated: "2025-01-01" },
            { title: "Archived recent", updated: "2026-11-09", archived: true },
            { title: "New active", updated: "2026-11-08" },
            { title: "Undated active" }
        ]
    }, NOW);
    assert.deepEqual(list.map(project => project.title),
        ["New active", "Old active", "Undated active", "Archived recent"]);
});

test("archived is false unless it is exactly true", () => {
    const list = Core.normalise([
        { title: "A", archived: "yes" },
        { title: "B", archived: true },
        { title: "C" }
    ], NOW);
    assert.equal(list.find(project => project.title === "A").archived, false);
    assert.equal(list.find(project => project.title === "B").archived, true);
    assert.equal(list.find(project => project.title === "C").archived, false);
});

test("every card carries its own age label", () => {
    const list = Core.normalise([
        { title: "Fresh", updated: "2026-11-10" },
        { title: "Stale", updated: "2026-10-01" },
        { title: "Undated" }
    ], NOW);
    const byTitle = title => list.find(project => project.title === title);
    assert.equal(byTitle("Fresh").age, "today");
    assert.equal(byTitle("Stale").age, "1 month ago");
    assert.equal(byTitle("Undated").age, "");
});

/* ---------------------------------------------------- filters and counts */

test("counts split the list into all, active and archived", () => {
    const list = Core.normalise([
        { title: "A" },
        { title: "B", archived: true },
        { title: "C", archived: true }
    ], NOW);
    assert.deepEqual(Core.counts(list), { all: 3, active: 1, archived: 2 });
    assert.deepEqual(Core.counts([]), { all: 0, active: 0, archived: 0 });
    assert.deepEqual(Core.counts(null), { all: 0, active: 0, archived: 0 });
});

test("filter returns the right slice and never the original array", () => {
    const list = Core.normalise([
        { title: "A" },
        { title: "B", archived: true }
    ], NOW);
    assert.deepEqual(Core.filter(list, "active").map(project => project.title), ["A"]);
    assert.deepEqual(Core.filter(list, "archived").map(project => project.title), ["B"]);
    assert.equal(Core.filter(list, "all").length, 2);
    assert.notEqual(Core.filter(list, "all"), list);
    assert.equal(Core.filter(list, "nonsense").length, 2);
});

test("tags are trimmed, capped and safe when missing", () => {
    const list = Core.normalise([{
        title: "Tagged",
        tags: ["  Web ", "", null, "Tooling", "A", "B", "C", "D", "E"]
    }], NOW);
    assert.deepEqual(list[0].tags, ["Web", "Tooling", "A", "B", "C", "D"]);
    assert.deepEqual(Core.normalise([{ title: "Untagged" }], NOW)[0].tags, []);
});

/* ----------------------------------------------------------------- report */

if (failures.length) {
    failures.forEach(({ name, error }) => {
        console.error(`FAIL  ${name}`);
        console.error(`      ${error.message}`);
    });
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exitCode = 1;
} else {
    console.log(`${passed} portfolio-core tests passed`);
}
