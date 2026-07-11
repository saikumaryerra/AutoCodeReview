Rules enforced:
  1.  Hard-coded values / magic strings → must be constants or enums
  2.  No ternary / inline && conditionals inside JSX return blocks
  3.  No date libs (moment / date-fns) directly in component files
  4.  Type safety – no `any`, `unknown`, `@ts-ignore`, `as any`
  5.  Code complexity – no deeply nested ternaries
  6.  React Context architecture – only { state, data, actions } keys
  7.  Naming conventions – meaningful names, consistent across feature
  8.  useFormContext / react-hook-form must be removed
  9.  Redux-style file splitting (slices/reducers/actions) not allowed
  10. console.log ONLY allowed inside catch blocks; banned everywhere else
  11. Prettier formatting – trailing spaces, mixed quotes, semicolons
  12. Extra blank lines – more than 2 consecutive blank lines (ESLint rule)
  13. Import order – React first, then external, then internal/relative
  14. Reusable code candidates – identical/near-identical blocks across files
  15. Logic that belongs in a utils file, not in a component/context
  16. Repeated hard-coded string values that should be a shared enum/const
  17. Code-pattern inconsistency across the same feature
  18. File & variable naming consistency across a feature
