/* External test tool only. Never a product/SDK compiler dependency.
 * Bind the selected PUBLIC frontend at build time, never its unwrapped target.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#ifndef BRABBLER_TEST_GIT_TARGET
#error "The original public Git frontend must be supplied; no fallback"
#endif

static const char target[] = BRABBLER_TEST_GIT_TARGET;

int main(int argc, char **argv) {
    (void)argc;
    if (setenv("GIT_CONFIG_NOSYSTEM", "1", 1) != 0) {
        perror("test git forwarder: setenv GIT_CONFIG_NOSYSTEM");
        return 126;
    }
    if (setenv("GIT_CONFIG_SYSTEM", "/dev/null", 1) != 0) {
        perror("test git forwarder: setenv GIT_CONFIG_SYSTEM");
        return 126;
    }
    if (setenv("GIT_CONFIG_GLOBAL", "/dev/null", 1) != 0) {
        perror("test git forwarder: setenv GIT_CONFIG_GLOBAL");
        return 126;
    }
    argv[0] = (char *)target;
    execv(target, argv);
    int saved_errno = errno;
    perror("test git forwarder: execv");
    return saved_errno == ENOENT ? 127 : 126;
}
