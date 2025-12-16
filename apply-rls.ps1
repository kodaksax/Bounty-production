#!/usr/bin/env pwsh
# Apply RLS migration to Supabase database via SQL

# Database connection details from your .env
$SUPABASE_HOST = "db.xwlwqzzphmmhghiqvkeu.supabase.co"
$DB_USER = "postgres"
$DB_PASSWORD = "slFAaRGFlbONQW5K"
$DB_NAME = "postgres"
$DB_PORT = 5432

# SQL statements to apply
$sqlStatements = @"
-- Enable RLS on notifications table
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- Notifications: Users can only SELECT/INSERT/UPDATE their own notifications
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
CREATE POLICY "notifications_insert_own" ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable RLS on push_tokens table
ALTER TABLE IF EXISTS public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Push tokens: Users can only SELECT/INSERT/UPDATE/DELETE their own tokens
DROP POLICY IF EXISTS "push_tokens_select_own" ON public.push_tokens;
CREATE POLICY "push_tokens_select_own" ON public.push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_insert_own" ON public.push_tokens;
CREATE POLICY "push_tokens_insert_own" ON public.push_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_update_own" ON public.push_tokens;
CREATE POLICY "push_tokens_update_own" ON public.push_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_delete_own" ON public.push_tokens;
CREATE POLICY "push_tokens_delete_own" ON public.push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Enable RLS on notification_preferences table
ALTER TABLE IF EXISTS public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notification preferences: Users can only SELECT/INSERT/UPDATE their own preferences
DROP POLICY IF EXISTS "notification_preferences_select_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_select_own" ON public.notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences_insert_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_insert_own" ON public.notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_preferences_update_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_update_own" ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
"@

# Build connection string
$ConnectionString = "Server=$SUPABASE_HOST;Port=$DB_PORT;User Id=$DB_USER;Password=$DB_PASSWORD;Database=$DB_NAME;SSL Mode=Require;"

Write-Host "🔐 Applying RLS policies to Supabase notifications tables..." -ForegroundColor Cyan

# Check if psql is available
$psqlPath = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psqlPath) {
    Write-Host "❌ psql not found. Please install PostgreSQL client tools or use Supabase Dashboard." -ForegroundColor Red
    Write-Host ""
    Write-Host "To apply manually via Supabase Dashboard:" -ForegroundColor Yellow
    Write-Host "1. Go to https://app.supabase.com"
    Write-Host "2. Select your project (xwlwqzzphmmhghiqvkeu)"
    Write-Host "3. Open the SQL Editor"
    Write-Host "4. Create a new query and paste the SQL from below:"
    Write-Host ""
    Write-Host $sqlStatements -ForegroundColor White
    Write-Host ""
    exit 1
}

# Save SQL to temp file
$tempSqlFile = New-TemporaryFile -Suffix ".sql"
$sqlStatements | Out-File -FilePath $tempSqlFile.FullName -Encoding UTF8

Write-Host "Executing SQL against Supabase..." -ForegroundColor Cyan

try {
    # Execute using psql with password
    $env:PGPASSWORD = $DB_PASSWORD
    
    & psql -h $SUPABASE_HOST -U $DB_USER -d $DB_NAME -p $DB_PORT -f $tempSqlFile.FullName -v ON_ERROR_STOP=1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ RLS policies applied successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Summary:" -ForegroundColor Green
        Write-Host "  • Enabled RLS on notifications table" -ForegroundColor Green
        Write-Host "  • Enabled RLS on push_tokens table" -ForegroundColor Green
        Write-Host "  • Enabled RLS on notification_preferences table" -ForegroundColor Green
        Write-Host ""
        Write-Host "Policies allow users to:" -ForegroundColor Cyan
        Write-Host "  • View/modify only their own notifications" -ForegroundColor Cyan
        Write-Host "  • View/modify/delete only their own push tokens" -ForegroundColor Cyan
        Write-Host "  • View/modify only their own notification preferences" -ForegroundColor Cyan
    } else {
        Write-Host "❌ Failed to apply RLS policies" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
} finally {
    # Cleanup
    Remove-Item -Path $tempSqlFile.FullName -Force -ErrorAction SilentlyContinue
    Remove-Item -Env:PGPASSWORD -ErrorAction SilentlyContinue
}
