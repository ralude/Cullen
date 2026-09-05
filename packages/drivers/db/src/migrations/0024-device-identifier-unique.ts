export const deviceIdentifierUniqueSql = `
create unique index devices_identifier_unique on devices(upper(identifier));
`;
