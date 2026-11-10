/* Test-only additive restriction matching Nix 2.35's xattr listing denials.
 * It never removes a filter or changes the host/daemon configuration. */
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/prctl.h>
#include <sys/syscall.h>

#if defined(__x86_64__)
#define NATIVE_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define NATIVE_ARCH AUDIT_ARCH_AARCH64
#else
#error "Test restriction requires a supported native Linux architecture"
#endif

int main(int argc, char **argv) {
    int first = 1, listing_errno = ENOTSUP;
    if (argc > 1 && strcmp(argv[1], "--permission-denied") == 0) {
        listing_errno = EPERM;
        first++;
    }
    if (argc <= first) {
        fprintf(stderr, "usage: brabbler-test-deny-xattrs [--permission-denied] COMMAND [ARGS...]\n");
        return 2;
    }
    struct sock_filter rules[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NATIVE_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_listxattr, 3, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_llistxattr, 2, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_flistxattr, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | listing_errno),
    };
    struct sock_fprog program = {
        .len = sizeof(rules) / sizeof(rules[0]), .filter = rules
    };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
        || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
        perror("install test-only restriction");
        return 2;
    }
    execvp(argv[first], argv + first);
    perror("exec test child");
    return 2;
}
