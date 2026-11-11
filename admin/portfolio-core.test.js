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

/* ----------------------------------------------------------- GitHub repos */

const REPOS = [
    {
        name: "XSTNSIONS",
        full_name: "shido275/XSTNSIONS",
        html_url: "https://github.com/shido275/XSTNSIONS",
        description: "A modular native instrument.",
        language: "C++",
        topics: ["audio", "plugin"],
        pushed_at: "2026-11-08T12:00:00Z",
        archived: false,
        fork: false
    },
    {
        name: "Old Thing",
        full_name: "shido275/old-thing",
        html_url: "https://github.com/shido275/old-thing",
        description: null,
        language: null,
        topics: [],
        pushed_at: "2025-02-01T00:00:00Z",
        archived: true
    },
    {
        name: "Forked Lib",
        full_name: "shido275/forked-lib",
        html_url: "https://github.com/shido275/forked-lib",
        pushed_at: "2026-11-01T00:00:00Z",
        fork: true
    }
];

test("a repository becomes a card with its push date, language and topics", () => {
    const card = Core.repoProjects({}, REPOS, NOW).find(project => project.title === "XSTNSIONS");
    assert.equal(card.blurb, "A modular native instrument.");
    assert.equal(card.link, "https://github.com/shido275/XSTNSIONS");
    assert.equal(card.linkLabel, "Open on GitHub");
    assert.equal(card.updated, "2026-11-08T12:00:00Z");
    assert.equal(card.age, "2 days ago");
    assert.equal(card.archived, false);
    assert.deepEqual(card.tags, ["C++", "audio", "plugin"]);
});

test("GitHub's archived flag is the stamp, and archived sits below active", () => {
    const list = Core.repoProjects({}, REPOS, NOW);
    assert.deepEqual(list.map(project => project.title), ["XSTNSIONS", "Old Thing"]);
    assert.equal(list[1].archived, true);
    assert.equal(list[1].blurb, "");
    assert.deepEqual(list[1].tags, []);
});

test("forks stay off the page unless the data file opts in", () => {
    const names = list => list.map(project => project.title);
    assert.equal(names(Core.repoProjects({}, REPOS, NOW)).includes("Forked Lib"), false);
    assert.equal(names(Core.repoProjects({ source: { includeForks: true } }, REPOS, NOW)).includes("Forked Lib"), true);
});

test("exclude matches the bare name or owner/name, in any case", () => {
    const byName = Core.repoProjects({ source: { exclude: ["xstnsions"] } }, REPOS, NOW);
    assert.equal(byName.some(project => project.title === "XSTNSIONS"), false);
    const byFullName = Core.repoProjects({ source: { exclude: ["SHIDO275/OLD-THING"] } }, REPOS, NOW);
    assert.equal(byFullName.some(project => project.title === "Old Thing"), false);
    assert.equal(byFullName.length, 1);
});

test("private, duplicate and nameless repositories never reach the page", () => {
    const list = Core.repoProjects({}, [
        { name: "Public", full_name: "shido275/public", pushed_at: "2026-11-09" },
        { name: "Secret", full_name: "shido275/secret", private: true, pushed_at: "2026-11-09" },
        { name: "Public", full_name: "shido275/public", pushed_at: "2026-11-09" },
        { full_name: "shido275/no-name", pushed_at: "2026-11-09" },
        null
    ], NOW);
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Public");
});

test("the api url names the account and asks for the biggest page", () => {
    assert.equal(Core.apiUrl({ source: { user: "shido275" } }),
        "https://api.github.com/users/shido275/repos?per_page=100&sort=pushed&direction=desc&type=owner");
    assert.equal(Core.apiUrl({}), "");
    assert.equal(Core.apiUrl(null), "");
});

test("a saved list is only trusted inside its window", () => {
    const fiveMinutes = NOW.getTime() - 5 * 60000;
    assert.equal(Core.isFresh(fiveMinutes, 10 * 60000, NOW), true);
    assert.equal(Core.isFresh(fiveMinutes, 2 * 60000, NOW), false);
    assert.equal(Core.isFresh(NOW.getTime() + 60000, 10 * 60000, NOW), false);
    assert.equal(Core.isFresh("nope", 10 * 60000, NOW), false);
    assert.equal(Core.isFresh(0, 10 * 60000, NOW), false);
});

test("a payload that is not a list is simply empty", () => {
    assert.deepEqual(Core.repoProjects({}, null, NOW), []);
    assert.deepEqual(Core.repoProjects({}, { message: "rate limited" }, NOW), []);
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
