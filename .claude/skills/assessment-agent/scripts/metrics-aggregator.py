#!/usr/bin/env python3
"""
Metrics Aggregator - Reads quality metrics from JSON input and produces formatted summary reports.

Usage:
    python metrics-aggregator.py <input.json> [output.md]

Input Format:
    {
        "project": "project-name",
        "reporting_period": "2024-02-01 to 2024-02-28",
        "metrics": {
            "code_quality": {
                "coverage": 85,
                "complexity": 7.2,
                "duplication": 3.5
            },
            "testing": {
                "unit_tests_passed": 250,
                "unit_tests_failed": 5,
                "integration_tests_passed": 45,
                "integration_tests_failed": 2
            },
            "performance": {
                "api_response_time_ms": 145,
                "error_rate_percent": 0.05
            },
            "security": {
                "critical_vulnerabilities": 0,
                "high_vulnerabilities": 2,
                "medium_vulnerabilities": 8
            }
        }
    }
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional


class MetricsAggregator:
    """Aggregates metrics and generates formatted reports."""

    def __init__(self, metrics_data: Dict[str, Any]):
        """Initialize with metrics data."""
        self.data = metrics_data
        self.project = metrics_data.get("project", "Unknown")
        self.period = metrics_data.get("reporting_period", "Unknown")
        self.metrics = metrics_data.get("metrics", {})

    def generate_summary(self) -> str:
        """Generate a markdown formatted summary report."""
        report = []
        report.append(f"# Quality Metrics Report\n")
        report.append(f"**Project:** {self.project}\n")
        report.append(f"**Period:** {self.period}\n")
        report.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

        # Code Quality Section
        if "code_quality" in self.metrics:
            report.append(self._format_code_quality())

        # Testing Section
        if "testing" in self.metrics:
            report.append(self._format_testing())

        # Performance Section
        if "performance" in self.metrics:
            report.append(self._format_performance())

        # Security Section
        if "security" in self.metrics:
            report.append(self._format_security())

        # Summary & Recommendations
        report.append(self._format_summary())

        return "\n".join(report)

    def _format_code_quality(self) -> str:
        """Format code quality metrics section."""
        section = ["## Code Quality Metrics\n"]
        cq = self.metrics["code_quality"]

        section.append("| Metric | Value | Target | Status |")
        section.append("|--------|-------|--------|--------|")

        # Coverage
        coverage = cq.get("coverage", 0)
        status = self._get_status(coverage, 80)
        section.append(f"| Code Coverage (%) | {coverage}% | 80% | {status} |")

        # Complexity
        complexity = cq.get("complexity", 0)
        status = self._get_status(complexity, 10, inverse=True)
        section.append(f"| Avg Complexity | {complexity} | <10 | {status} |")

        # Duplication
        duplication = cq.get("duplication", 0)
        status = self._get_status(duplication, 5, inverse=True)
        section.append(f"| Duplication (%) | {duplication}% | <5% | {status} |")

        section.append("")
        return "\n".join(section)

    def _format_testing(self) -> str:
        """Format testing metrics section."""
        section = ["## Testing Metrics\n"]
        testing = self.metrics["testing"]

        # Calculate test results
        unit_passed = testing.get("unit_tests_passed", 0)
        unit_failed = testing.get("unit_tests_failed", 0)
        unit_total = unit_passed + unit_failed
        unit_rate = (unit_passed / unit_total * 100) if unit_total > 0 else 0

        integration_passed = testing.get("integration_tests_passed", 0)
        integration_failed = testing.get("integration_tests_failed", 0)
        integration_total = integration_passed + integration_failed
        integration_rate = (integration_passed / integration_total * 100) if integration_total > 0 else 0

        section.append("| Metric | Passed | Failed | Pass Rate |")
        section.append("|--------|--------|--------|-----------|")
        section.append(f"| Unit Tests | {unit_passed} | {unit_failed} | {unit_rate:.1f}% |")
        section.append(f"| Integration Tests | {integration_passed} | {integration_failed} | {integration_rate:.1f}% |")
        section.append("")

        return "\n".join(section)

    def _format_performance(self) -> str:
        """Format performance metrics section."""
        section = ["## Performance Metrics\n"]
        perf = self.metrics["performance"]

        section.append("| Metric | Value | Target | Status |")
        section.append("|--------|-------|--------|--------|")

        # Response time
        if "api_response_time_ms" in perf:
            response_time = perf["api_response_time_ms"]
            status = self._get_status(response_time, 200, inverse=True)
            section.append(f"| API Response Time (ms) | {response_time}ms | <200ms | {status} |")

        # Error rate
        if "error_rate_percent" in perf:
            error_rate = perf["error_rate_percent"]
            status = self._get_status(error_rate, 0.1, inverse=True)
            section.append(f"| Error Rate (%) | {error_rate}% | <0.1% | {status} |")

        section.append("")
        return "\n".join(section)

    def _format_security(self) -> str:
        """Format security metrics section."""
        section = ["## Security Metrics\n"]
        sec = self.metrics["security"]

        critical = sec.get("critical_vulnerabilities", 0)
        high = sec.get("high_vulnerabilities", 0)
        medium = sec.get("medium_vulnerabilities", 0)
        low = sec.get("low_vulnerabilities", 0)

        section.append("| Severity | Count | Target | Status |")
        section.append("|----------|-------|--------|--------|")

        critical_status = "🔴 FAIL" if critical > 0 else "🟢 PASS"
        section.append(f"| Critical | {critical} | 0 | {critical_status} |")

        high_status = "🟡 WARN" if high > 5 else "🟢 PASS"
        section.append(f"| High | {high} | <5 | {high_status} |")

        section.append(f"| Medium | {medium} | <10 | 🟢 INFO |")
        section.append(f"| Low | {low} | No limit | 🟢 INFO |")

        section.append("")
        return "\n".join(section)

    def _format_summary(self) -> str:
        """Format summary and recommendations."""
        section = ["## Summary & Recommendations\n"]

        recommendations = []

        # Check code quality
        cq = self.metrics.get("code_quality", {})
        if cq.get("coverage", 0) < 80:
            recommendations.append("- Increase unit test coverage (currently below 80% target)")
        if cq.get("complexity", 0) > 10:
            recommendations.append("- Refactor high-complexity functions to reduce cyclomatic complexity")
        if cq.get("duplication", 0) > 5:
            recommendations.append("- Extract duplicate code into shared utilities")

        # Check testing
        testing = self.metrics.get("testing", {})
        unit_total = testing.get("unit_tests_passed", 0) + testing.get("unit_tests_failed", 0)
        if testing.get("unit_tests_failed", 0) > 0:
            recommendations.append(f"- Fix {testing.get('unit_tests_failed', 0)} failing unit tests")

        # Check performance
        perf = self.metrics.get("performance", {})
        if perf.get("error_rate_percent", 0) > 0.1:
            recommendations.append("- Investigate elevated error rate in production")

        # Check security
        sec = self.metrics.get("security", {})
        if sec.get("critical_vulnerabilities", 0) > 0:
            recommendations.append("- URGENT: Address critical security vulnerabilities")
        if sec.get("high_vulnerabilities", 0) > 0:
            recommendations.append("- Priority: Remediate high-severity vulnerabilities")

        if recommendations:
            section.append("### Action Items\n")
            for rec in recommendations:
                section.append(rec)
        else:
            section.append("### Status\n")
            section.append("All key metrics are within acceptable ranges. Continue monitoring trends.")

        section.append("")
        return "\n".join(section)

    @staticmethod
    def _get_status(value: float, target: float, inverse: bool = False) -> str:
        """Get status indicator based on value and target.

        Args:
            value: The metric value
            target: The target value
            inverse: If True, lower is better (for metrics like complexity, error rate)

        Returns:
            Status indicator emoji/text
        """
        if inverse:
            # For metrics where lower is better
            if value <= target:
                return "🟢"
            elif value <= target * 1.2:
                return "🟡"
            else:
                return "🔴"
        else:
            # For metrics where higher is better
            if value >= target:
                return "🟢"
            elif value >= target * 0.8:
                return "🟡"
            else:
                return "🔴"


def load_metrics(filepath: str) -> Dict[str, Any]:
    """Load metrics from JSON file."""
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: File not found: {filepath}")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in file: {filepath}")
        sys.exit(1)


def save_report(report: str, filepath: Optional[str] = None) -> None:
    """Save report to file or stdout."""
    if filepath:
        with open(filepath, 'w') as f:
            f.write(report)
        print(f"Report saved to: {filepath}")
    else:
        print(report)


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python metrics-aggregator.py <input.json> [output.md]")
        print("\nExample:")
        print("  python metrics-aggregator.py metrics.json report.md")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    # Load and process metrics
    metrics = load_metrics(input_file)
    aggregator = MetricsAggregator(metrics)
    report = aggregator.generate_summary()

    # Save or print report
    save_report(report, output_file)


if __name__ == "__main__":
    main()
