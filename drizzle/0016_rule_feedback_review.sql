ALTER TABLE `riskshield_rule_feedback_cases`
ADD COLUMN `evaluation_case_id` text;

CREATE INDEX `riskshield_rule_feedback_cases_evaluation_case_idx`
ON `riskshield_rule_feedback_cases` (`evaluation_case_id`);
