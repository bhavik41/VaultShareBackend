process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret";
process.env.REFRESH_SECRET = process.env.REFRESH_SECRET ?? "test-refresh-secret";
process.env.TEMP_SECRET = process.env.TEMP_SECRET ?? "test-temp-secret";
process.env.MAX_FILE_SIZE_MB = process.env.MAX_FILE_SIZE_MB ?? "50";
