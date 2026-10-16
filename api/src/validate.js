// Checks request data against a zod "schema" (a description of what valid
// data looks like). Anything that doesn't match is rejected with a 400 before
// our code ever touches it.
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return { data: result.data };
  return {
    errors: result.error.issues.map(issue => ({
      field: issue.path.join('.') || null,
      message: issue.message,
    })),
  };
}
