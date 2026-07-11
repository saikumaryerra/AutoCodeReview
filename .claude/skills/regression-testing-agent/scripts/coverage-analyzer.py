#!/usr/bin/env python3
"""
Coverage Analyzer - Parse and summarize coverage reports in multiple formats.

Supports:
  - LCOV format (.lcov files)
  - Coverage.py JSON format (coverage.json)
  - Cobertura XML format (coverage.xml)

Usage:
  python coverage-analyzer.py <coverage-report-file> [options]

Options:
  --format {auto,lcov,coverage-py,cobertura}
      Specify the format explicitly (default: auto-detect from file extension)
  --threshold <percentage>
      Show warning if coverage is below threshold (default: 80)
  --output {text,json,csv}
      Output format (default: text)
  --min-line-coverage <percentage>
      Minimum required line coverage per file (default: 70)
  --exclude-pattern <regex>
      Exclude files matching regex pattern
  --sort {file,coverage,lines}
      Sort output by file name, coverage %, or lines (default: coverage)
"""

import json
import re
import sys
import argparse
from pathlib import Path
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET


@dataclass
class FileCoverage:
    """Coverage data for a single file."""
    filename: str
    line_coverage: float
    branch_coverage: Optional[float]
    function_coverage: Optional[float]
    lines_covered: int
    lines_total: int


class CoverageReport:
    """Base class for coverage report parsing."""

    def __init__(self):
        self.files: Dict[str, FileCoverage] = {}

    def parse(self, filepath: str) -> None:
        """Parse the coverage report. Implemented by subclasses."""
        raise NotImplementedError

    def get_summary(self) -> Tuple[float, int, int]:
        """Calculate overall coverage percentage and totals."""
        if not self.files:
            return 0.0, 0, 0

        total_covered = sum(f.lines_covered for f in self.files.values())
        total_lines = sum(f.lines_total for f in self.files.values())

        if total_lines == 0:
            return 0.0, 0, 0

        coverage = (total_covered / total_lines) * 100
        return coverage, total_covered, total_lines

    def filter_files(self, exclude_pattern: Optional[str] = None) -> None:
        """Remove files matching exclude pattern."""
        if not exclude_pattern:
            return

        regex = re.compile(exclude_pattern)
        files_to_remove = [f for f in self.files.keys() if regex.search(f)]

        for f in files_to_remove:
            del self.files[f]


class LcovReport(CoverageReport):
    """Parse LCOV format coverage reports."""

    def parse(self, filepath: str) -> None:
        """Parse LCOV file format."""
        with open(filepath, 'r') as f:
            current_file = None
            lines_found = 0
            lines_hit = 0

            for line in f:
                line = line.strip()

                if line.startswith('SF:'):
                    current_file = line[3:]

                elif line.startswith('FN:'):
                    # Function definition: FN:<line>,<function name>
                    pass

                elif line.startswith('FNDA:'):
                    # Function data: FNDA:<hit count>,<function name>
                    pass

                elif line.startswith('FNF:'):
                    # Functions found
                    pass

                elif line.startswith('FNH:'):
                    # Functions hit
                    pass

                elif line.startswith('DA:'):
                    # Line data: DA:<line number>,<hit count>
                    parts = line[3:].split(',')
                    if len(parts) == 2:
                        hit_count = int(parts[1])
                        lines_found += 1
                        if hit_count > 0:
                            lines_hit += 1

                elif line.startswith('LF:'):
                    # Lines found
                    lines_found = int(line[3:])

                elif line.startswith('LH:'):
                    # Lines hit
                    lines_hit = int(line[3:])

                elif line == 'end_of_record':
                    if current_file and lines_found > 0:
                        coverage = (lines_hit / lines_found) * 100
                        self.files[current_file] = FileCoverage(
                            filename=current_file,
                            line_coverage=coverage,
                            branch_coverage=None,
                            function_coverage=None,
                            lines_covered=lines_hit,
                            lines_total=lines_found
                        )
                    current_file = None
                    lines_found = 0
                    lines_hit = 0


class CoveragePyReport(CoverageReport):
    """Parse coverage.py JSON format reports."""

    def parse(self, filepath: str) -> None:
        """Parse coverage.py JSON file."""
        with open(filepath, 'r') as f:
            data = json.load(f)

        files_data = data.get('files', {})

        for filename, file_data in files_data.items():
            summary = file_data.get('summary', {})

            lines_total = summary.get('num_statements', 0)
            lines_covered = summary.get('covered_lines', 0)

            if lines_total == 0:
                line_coverage = 0.0
            else:
                line_coverage = (lines_covered / lines_total) * 100

            branch_coverage = None
            if 'num_branches' in summary and summary['num_branches'] > 0:
                branches_covered = summary.get('covered_branches', 0)
                branch_coverage = (branches_covered / summary['num_branches']) * 100

            self.files[filename] = FileCoverage(
                filename=filename,
                line_coverage=line_coverage,
                branch_coverage=branch_coverage,
                function_coverage=None,
                lines_covered=lines_covered,
                lines_total=lines_total
            )


class CoberturaReport(CoverageReport):
    """Parse Cobertura XML format reports."""

    def parse(self, filepath: str) -> None:
        """Parse Cobertura XML file."""
        tree = ET.parse(filepath)
        root = tree.getroot()

        for package in root.findall('.//package'):
            for source_file in package.findall('.//class'):
                filename = source_file.get('filename', '')
                line_rate = float(source_file.get('line-rate', 0))
                branch_rate = float(source_file.get('branch-rate', 0))

                # Count lines
                lines_total = 0
                lines_covered = 0

                for line in source_file.findall('.//line'):
                    hits = int(line.get('hits', 0))
                    lines_total += 1
                    if hits > 0:
                        lines_covered += 1

                if lines_total == 0:
                    lines_total = int(source_file.get('complexity', 1))

                line_coverage = line_rate * 100

                self.files[filename] = FileCoverage(
                    filename=filename,
                    line_coverage=line_coverage,
                    branch_coverage=branch_rate * 100 if branch_rate > 0 else None,
                    function_coverage=None,
                    lines_covered=lines_covered,
                    lines_total=lines_total
                )


def detect_format(filepath: str) -> str:
    """Auto-detect coverage report format from file extension and content."""
    path = Path(filepath)
    suffix = path.suffix.lower()

    if suffix == '.lcov':
        return 'lcov'
    elif suffix == '.json':
        # Check if it's coverage.py JSON
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                if 'files' in data and isinstance(data['files'], dict):
                    return 'coverage-py'
        except:
            pass
    elif suffix in ['.xml', '.coverage']:
        return 'cobertura'

    # Default fallback
    return 'lcov'


def format_text_output(report: CoverageReport, threshold: int = 80,
                      min_line_coverage: int = 70, sort_by: str = 'coverage') -> str:
    """Format coverage report as human-readable text."""
    output = []
    output.append("=" * 80)
    output.append("COVERAGE ANALYSIS REPORT")
    output.append("=" * 80)
    output.append("")

    # Summary statistics
    overall_coverage, total_covered, total_lines = report.get_summary()
    output.append(f"Overall Coverage: {overall_coverage:.2f}% ({total_covered}/{total_lines} lines)")

    if overall_coverage < threshold:
        output.append(f"⚠️  WARNING: Coverage below threshold of {threshold}%")

    output.append("")
    output.append("-" * 80)
    output.append(f"{'File':<50} {'Coverage':<12} {'Lines':<15}")
    output.append("-" * 80)

    # Sort files
    files_list = list(report.files.values())
    if sort_by == 'file':
        files_list.sort(key=lambda x: x.filename)
    elif sort_by == 'lines':
        files_list.sort(key=lambda x: x.lines_total, reverse=True)
    else:  # coverage
        files_list.sort(key=lambda x: x.line_coverage)

    # List files
    for file_info in files_list:
        coverage_str = f"{file_info.line_coverage:.1f}%"
        lines_str = f"{file_info.lines_covered}/{file_info.lines_total}"

        # Add warning indicator for low coverage
        warning = ""
        if file_info.line_coverage < min_line_coverage:
            warning = " ⚠️"

        # Truncate filename for display
        display_filename = file_info.filename
        if len(display_filename) > 50:
            display_filename = "..." + display_filename[-47:]

        output.append(f"{display_filename:<50} {coverage_str:<12} {lines_str:<15}{warning}")

    output.append("-" * 80)

    # Coverage distribution
    output.append("")
    output.append("Coverage Distribution:")
    ranges = [
        (90, 100, "Excellent (90-100%)"),
        (80, 90, "Good (80-90%)"),
        (70, 80, "Fair (70-80%)"),
        (0, 70, "Poor (<70%)")
    ]

    for min_cov, max_cov, label in ranges:
        count = sum(1 for f in report.files.values()
                   if min_cov <= f.line_coverage < max_cov or
                   (max_cov == 100 and f.line_coverage >= min_cov))
        output.append(f"  {label:<25} {count} files")

    output.append("")
    return "\n".join(output)


def format_json_output(report: CoverageReport) -> str:
    """Format coverage report as JSON."""
    overall_coverage, total_covered, total_lines = report.get_summary()

    data = {
        "summary": {
            "overall_coverage": round(overall_coverage, 2),
            "lines_covered": total_covered,
            "lines_total": total_lines,
            "num_files": len(report.files)
        },
        "files": []
    }

    for file_info in sorted(report.files.values(), key=lambda x: x.filename):
        file_data = {
            "filename": file_info.filename,
            "line_coverage": round(file_info.line_coverage, 2),
            "lines_covered": file_info.lines_covered,
            "lines_total": file_info.lines_total
        }
        if file_info.branch_coverage is not None:
            file_data["branch_coverage"] = round(file_info.branch_coverage, 2)
        if file_info.function_coverage is not None:
            file_data["function_coverage"] = round(file_info.function_coverage, 2)

        data["files"].append(file_data)

    return json.dumps(data, indent=2)


def format_csv_output(report: CoverageReport) -> str:
    """Format coverage report as CSV."""
    output = []
    output.append("Filename,Line Coverage %,Lines Covered,Lines Total,Branch Coverage %,Function Coverage %")

    for file_info in sorted(report.files.values(), key=lambda x: x.filename):
        branch = file_info.branch_coverage if file_info.branch_coverage is not None else ""
        function = file_info.function_coverage if file_info.function_coverage is not None else ""

        output.append(
            f'"{file_info.filename}",{file_info.line_coverage:.2f},'
            f'{file_info.lines_covered},{file_info.lines_total},{branch},{function}'
        )

    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(
        description='Parse and analyze code coverage reports in multiple formats'
    )
    parser.add_argument('report_file', help='Path to coverage report file')
    parser.add_argument('--format', choices=['auto', 'lcov', 'coverage-py', 'cobertura'],
                       default='auto', help='Coverage report format (default: auto-detect)')
    parser.add_argument('--threshold', type=int, default=80,
                       help='Coverage threshold for warnings (default: 80)')
    parser.add_argument('--output', choices=['text', 'json', 'csv'], default='text',
                       help='Output format (default: text)')
    parser.add_argument('--min-line-coverage', type=int, default=70,
                       help='Minimum line coverage per file (default: 70)')
    parser.add_argument('--exclude-pattern', type=str, default=None,
                       help='Regex pattern for files to exclude')
    parser.add_argument('--sort', choices=['file', 'coverage', 'lines'], default='coverage',
                       help='Sort output by file name, coverage, or lines (default: coverage)')

    args = parser.parse_args()

    # Detect format if needed
    report_format = args.format
    if report_format == 'auto':
        report_format = detect_format(args.report_file)

    # Select appropriate parser
    if report_format == 'lcov':
        report = LcovReport()
    elif report_format == 'coverage-py':
        report = CoveragePyReport()
    elif report_format == 'cobertura':
        report = CoberturaReport()
    else:
        print(f"Error: Unknown format '{report_format}'", file=sys.stderr)
        sys.exit(1)

    # Parse the report
    try:
        report.parse(args.report_file)
    except Exception as e:
        print(f"Error parsing coverage report: {e}", file=sys.stderr)
        sys.exit(1)

    # Apply filters
    report.filter_files(args.exclude_pattern)

    # Format output
    if args.output == 'json':
        output = format_json_output(report)
    elif args.output == 'csv':
        output = format_csv_output(report)
    else:  # text
        output = format_text_output(report, args.threshold, args.min_line_coverage, args.sort)

    print(output)


if __name__ == '__main__':
    main()
