@echo off
rem Builds MTCServerControl.jar (needs a JDK 17+). libs\ holds the Spigot API and Gson, used only for compiling.
cd /d "%~dp0"
if exist build rmdir /s /q build
mkdir build
javac --release 17 -encoding UTF-8 -cp "libs\spigot-api.jar;libs\gson.jar" -d build src\cloud\kovaihost\mtc\*.java || exit /b 1
copy /y resources\plugin.yml build\ >nul
copy /y resources\config.yml build\ >nul
jar --create --file MTCServerControl.jar -C build .
rmdir /s /q build
echo Built MTCServerControl.jar
