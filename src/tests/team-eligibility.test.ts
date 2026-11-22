import { describe, it, expect } from "vitest";
import {
  evaluateTeamEligibilityForDob,
  defaultAgeCategoryRules,
  type Team,
} from "../lib/data-store";

const makeTeam = (overrides: Partial<Team> = {}): Team => ({
  id: "team-u14-boys",
  name: "U-14 Boys Elite",
  category: "U-14",
  gender: "Boys",
  headCoach: "Coach Karim",
  coach: "Coach Karim",
  assistant: "Coach Hadi",
  branch: "Downtown Arena",
  players: 10,
  wins: 5,
  losses: 2,
  monthlyFee: 100,
  allowYoungerPlayers: false,
  allowOlderPlayers: false,
  ...overrides,
});

describe("evaluateTeamEligibilityForDob", () => {
  // For U-14 in defaultAgeCategoryRules:
  // startDate = "2012-01-01", endDate = "2013-12-31"

  it("matches a player whose DOB and gender fall strictly inside the U-14 window (2012-01-01 to 2013-12-31)", () => {
    const team = makeTeam();
    const resStart = evaluateTeamEligibilityForDob(
      "2012-01-01",
      team,
      defaultAgeCategoryRules,
      "Male",
    );
    const resEnd = evaluateTeamEligibilityForDob(
      "2013-12-31",
      team,
      defaultAgeCategoryRules,
      "Male",
    );

    expect(resStart.eligible).toBe(true);
    expect(resStart.matchType).toBe("exact");
    expect(resStart.badgeLabel).toBe("Exact Match");
    expect(resStart.birthYearRange).toBe("2012–2013");

    expect(resEnd.eligible).toBe(true);
    expect(resEnd.matchType).toBe("exact");
    expect(resEnd.badgeLabel).toBe("Exact Match");
  });

  it("rejects younger players (DOB > rule.endDate) when allowYoungerPlayers is false, and allows them when true", () => {
    const strictTeam = makeTeam({ allowYoungerPlayers: false });
    const flexTeam = makeTeam({ allowYoungerPlayers: true });

    const blocked = evaluateTeamEligibilityForDob(
      "2014-03-10",
      strictTeam,
      defaultAgeCategoryRules,
      "Male",
    );
    expect(blocked.eligible).toBe(false);
    expect(blocked.matchType).toBe("ineligible");
    expect(blocked.badgeLabel).toBe("Ineligible");

    const allowed = evaluateTeamEligibilityForDob(
      "2014-03-10",
      flexTeam,
      defaultAgeCategoryRules,
      "Male",
    );
    expect(allowed.eligible).toBe(true);
    expect(allowed.matchType).toBe("younger");
    expect(allowed.badgeLabel).toBe("Playing Up - Younger");
  });

  it("rejects older players (DOB < rule.startDate) when allowOlderPlayers is false, and allows them when true", () => {
    const strictTeam = makeTeam({ allowOlderPlayers: false });
    const flexTeam = makeTeam({ allowOlderPlayers: true });

    const blocked = evaluateTeamEligibilityForDob(
      "2011-08-22",
      strictTeam,
      defaultAgeCategoryRules,
      "Male",
    );
    expect(blocked.eligible).toBe(false);
    expect(blocked.matchType).toBe("ineligible");
    expect(blocked.badgeLabel).toBe("Ineligible");

    const allowed = evaluateTeamEligibilityForDob(
      "2011-08-22",
      flexTeam,
      defaultAgeCategoryRules,
      "Male",
    );
    expect(allowed.eligible).toBe(true);
    expect(allowed.matchType).toBe("older");
    expect(allowed.badgeLabel).toBe("Over-Age Exception");
  });

  it("enforces gender matching for Male/Female squads while allowing Co-Ed (Mixed) squads for all genders", () => {
    const boysTeam = makeTeam({ gender: "Boys" });
    const girlsTeam = makeTeam({ gender: "Girls" });
    const mixedTeam = makeTeam({ gender: "Mixed" });

    const femaleOnBoys = evaluateTeamEligibilityForDob(
      "2013-06-01",
      boysTeam,
      defaultAgeCategoryRules,
      "Female",
    );
    expect(femaleOnBoys.eligible).toBe(false);
    expect(femaleOnBoys.matchType).toBe("ineligible_gender");

    const maleOnGirls = evaluateTeamEligibilityForDob(
      "2013-06-01",
      girlsTeam,
      defaultAgeCategoryRules,
      "Male",
    );
    expect(maleOnGirls.eligible).toBe(false);
    expect(maleOnGirls.matchType).toBe("ineligible_gender");

    const femaleOnMixed = evaluateTeamEligibilityForDob(
      "2013-06-01",
      mixedTeam,
      defaultAgeCategoryRules,
      "Female",
    );
    const maleOnMixed = evaluateTeamEligibilityForDob(
      "2013-06-01",
      mixedTeam,
      defaultAgeCategoryRules,
      "Male",
    );
    expect(femaleOnMixed.eligible).toBe(true);
    expect(maleOnMixed.eligible).toBe(true);
  });
});
