import { describe, expect, test } from "bun:test";
import {
	teamResponseEntityId,
	validateTeamAssignmentSet,
	validateTeamDecision,
} from "./team-domain";

const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;

describe("team collaboration domain", () => {
	test("normalizes capacity-valid assignments and rejects duplicate members", () => {
		expect(
			validateTeamAssignmentSet(
				{
					teams: [
						{
							id: "ttm_alpha",
							name: " Alpha ",
							color: "#00aa55",
							memberUserIds: [userId(2), userId(1)],
						},
					],
				},
				2,
			),
		).toEqual({
			teams: [
				{
					id: "ttm_alpha",
					name: "Alpha",
					color: "#00AA55",
					memberUserIds: [userId(1), userId(2)],
				},
			],
		});
		expect(() =>
			validateTeamAssignmentSet(
				{
					teams: [
						{
							id: "ttm_alpha",
							name: "Alpha",
							color: null,
							memberUserIds: [userId(1), userId(1)],
						},
					],
				},
				2,
			),
		).toThrow("Teams and active members must be unique and capacity-valid.");
	});

	test("normalizes decisions and derives actor-bound response IDs", () => {
		expect(
			validateTeamDecision("tdc_lunch", {
				title: " Lunch? ",
				state: "open",
				options: [
					{ id: "tdo_pizza", label: " Pizza " },
					{ id: "tdo_salad", label: "Salad" },
				],
			}),
		).toEqual({
			title: "Lunch?",
			state: "open",
			options: [
				{ id: "tdo_pizza", label: "Pizza" },
				{ id: "tdo_salad", label: "Salad" },
			],
		});
		expect(teamResponseEntityId("tdc_lunch", userId(1))).toBe(
			`trp_tdc_lunch:${userId(1)}`,
		);
	});
});
