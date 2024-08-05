#!/usr/bin/env bash

set -e

if [ -n "$CI_JOB_NAME" ]; then
  echo "[CI_JOB_NAME=$CI_JOB_NAME]"
fi

if [ "$NO_CHANGE_USER" = "" ]; then
  if [ "$LOCAL_USER_ID" != "" ]; then
    id -u user &>/dev/null || useradd --shell /bin/bash -u $LOCAL_USER_ID -o -c "" -m user
    export HOME=/home/user
    unset LOCAL_USER_ID

    # Ensure that runners are able to execute git commands in the worktree,
    # overriding the typical git protections. In our docker container we're running
    # as root, while the user owning the checkout is not root.
    # This is only necessary when we change the user, otherwise we should
    # already be running with the right user.
    #
    # For NO_CHANGE_USER done in the small number of Dockerfiles affected.
    echo -e '[safe]\n\tdirectory = *' > /home/user/.gitconfig

    exec su --preserve-environment -c "env PATH=$PATH \"$0\"" user
  fi
fi

# only enable core dump on Linux
if [ -f /proc/sys/kernel/core_pattern ]; then
  ulimit -c unlimited
fi

# There was a bad interaction between "old" 32-bit binaries on current 64-bit
# kernels with selinux enabled, where ASLR mmap would sometimes choose a low
# address and then block it for being below `vm.mmap_min_addr` -> `EACCES`.
# This is probably a kernel bug, but setting `ulimit -Hs` works around it.
# See also `dist-i686-linux` where this setting is enabled.
if [ "$SET_HARD_RLIMIT_STACK" = "1" ]; then
  rlimit_stack=$(ulimit -Ss)
  if [ "$rlimit_stack" != "" ]; then
    ulimit -Hs "$rlimit_stack"
  fi
fi

ci_dir=`cd $(dirname $0) && pwd`
source "$ci_dir/shared.sh"

export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

# suppress change-tracker warnings on CI
if [ "$CI" != "" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set change-id=99999999"
fi

# If runner uses an incompatible option and `FORCE_CI_RUSTC` is not defined,
# switch to in-tree rustc.
if [ "$FORCE_CI_RUSTC" == "" ]; then
    DISABLE_CI_RUSTC_IF_INCOMPATIBLE=1
fi

if ! isCI || isCiBranch auto || isCiBranch beta || isCiBranch try || isCiBranch try-perf || \
  isCiBranch automation/bors/try; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set build.print-step-timings --enable-verbose-tests"
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set build.metrics"
    HAS_METRICS=1
fi

RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-verbose-configure"
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-sccache"
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --disable-manage-submodules"
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-locked-deps"
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-cargo-native-static"
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.codegen-units-std=1"
# rust-lang/promote-release will recompress CI artifacts, and while we care
# about the per-commit artifact sizes, it's not as important that they're
# highly compressed as it is that the process is fast. Best compression
# generally implies single-threaded compression which results in wasting most
# of our CPU resources.
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set dist.compression-profile=balanced"

# When building for mingw, limit the number of parallel linker jobs during
# the LLVM build, as not to run out of memory.
# This is an attempt to fix the spurious build error tracked by
# https://github.com/rust-lang/rust/issues/108227.
if isKnownToBeMingwBuild; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set llvm.link-jobs=1"
fi

# Only produce xz tarballs on CI. gz tarballs will be generated by the release
# process by recompressing the existing xz ones. This decreases the storage
# space required for CI artifacts.
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --dist-compression-formats=xz"

if [ "$EXTERNAL_LLVM" = "1" ]; then
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.lld=false"
fi

# Enable the `c` feature for compiler_builtins, but only when the `compiler-rt` source is available
# (to avoid spending a lot of time cloning llvm)
if [ "$EXTERNAL_LLVM" = "" ]; then
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set build.optimized-compiler-builtins"
  # Likewise, only demand we test all LLVM components if we know we built LLVM with them
  export COMPILETEST_REQUIRE_ALL_LLVM_COMPONENTS=1
elif [ "$DEPLOY$DEPLOY_ALT" = "1" ]; then
    echo "error: dist builds should always use optimized compiler-rt!" >&2
    exit 1
fi

if [ "$DIST_SRC" = "" ]; then
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --disable-dist-src"
fi

# Always set the release channel for bootstrap; this is normally not important (i.e., only dist
# builds would seem to matter) but in practice bootstrap wants to know whether we're targeting
# master, beta, or stable with a build to determine whether to run some checks (notably toolstate).
export RUST_RELEASE_CHANNEL=$(releaseChannel)
RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --release-channel=$RUST_RELEASE_CHANNEL"

if [ "$DEPLOY$DEPLOY_ALT" = "1" ]; then
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-llvm-static-stdcpp"
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.remap-debuginfo"
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --debuginfo-level-std=1"

  if [ "$NO_LLVM_ASSERTIONS" = "1" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --disable-llvm-assertions"
  elif [ "$DEPLOY_ALT" != "" ]; then
    if [ "$ALT_PARALLEL_COMPILER" = "" ]; then
      RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.parallel-compiler=false"
    fi
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-llvm-assertions"
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.verify-llvm-ir"
  fi

  CODEGEN_BACKENDS="${CODEGEN_BACKENDS:-llvm}"
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.codegen-backends=$CODEGEN_BACKENDS"
else
  # We almost always want debug assertions enabled, but sometimes this takes too
  # long for too little benefit, so we just turn them off.
  if [ "$NO_DEBUG_ASSERTIONS" = "" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-debug-assertions"
  fi

  # Same for overflow checks
  if [ "$NO_OVERFLOW_CHECKS" = "" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-overflow-checks"
  fi

  # In general we always want to run tests with LLVM assertions enabled, but not
  # all platforms currently support that, so we have an option to disable.
  if [ "$NO_LLVM_ASSERTIONS" = "" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-llvm-assertions"
  fi

  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.verify-llvm-ir"

  # When running gcc backend tests, we need to install `libgccjit` and to not run llvm codegen
  # tests as it will fail them.
  if [[ "${ENABLE_GCC_CODEGEN}" == "1" ]]; then
    # Test the Cranelift and GCC backends in CI. Bootstrap knows which targets to run tests on.
    CODEGEN_BACKENDS="${CODEGEN_BACKENDS:-llvm,cranelift,gcc}"
  else
    # Test the Cranelift backend in CI. Bootstrap knows which targets to run tests on.
    CODEGEN_BACKENDS="${CODEGEN_BACKENDS:-llvm,cranelift}"
  fi
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.codegen-backends=$CODEGEN_BACKENDS"

  # We enable this for non-dist builders, since those aren't trying to produce
  # fresh binaries. We currently don't entirely support distributing a fresh
  # copy of the compiler (including llvm tools, etc.) if we haven't actually
  # built LLVM, since not everything necessary is copied into the
  # local-usage-only LLVM artifacts. If that changes, this could maybe be made
  # true for all builds. In practice it's probably a good idea to keep building
  # LLVM continuously on at least some builders to ensure it works, though.
  # (And PGO is its own can of worms).
  if [ "$NO_DOWNLOAD_CI_LLVM" = "" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set llvm.download-ci-llvm=if-unchanged"
  else
    # CI rustc requires CI LLVM to be enabled (see https://github.com/rust-lang/rust/issues/123586).
    NO_DOWNLOAD_CI_RUSTC=1
    # When building for CI we want to use the static C++ Standard library
    # included with LLVM, since a dynamic libstdcpp may not be available.
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set llvm.static-libstdcpp"
  fi

  if [ "$NO_DOWNLOAD_CI_RUSTC" = "" ]; then
    RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --set rust.download-rustc=if-unchanged"
  fi
fi

if [ "$ENABLE_GCC_CODEGEN" = "1" ]; then
  # If `ENABLE_GCC_CODEGEN` is set and not empty, we add the `--enable-new-symbol-mangling`
  # argument to `RUST_CONFIGURE_ARGS` and set the `GCC_EXEC_PREFIX` environment variable.
  # `cg_gcc` doesn't support the legacy mangling so we need to enforce the new one
  # if we run `cg_gcc` tests.
  RUST_CONFIGURE_ARGS="$RUST_CONFIGURE_ARGS --enable-new-symbol-mangling"
fi

# Print the date from the local machine and the date from an external source to
# check for clock drifts. An HTTP URL is used instead of HTTPS since on Azure
# Pipelines it happened that the certificates were marked as expired.
datecheck() {
  # If an error has happened, we do not want to start a new group, because that will collapse
  # a previous group that might have contained the error log.
  exit_code=$?

  if [ $exit_code -eq 0 ]
  then
    echo "::group::Clock drift check"
  fi

  echo -n "  local time: "
  date
  echo -n "  network time: "
  curl -fs --head http://ci-caches.rust-lang.org | grep ^Date: \
      | sed 's/Date: //g' || true

  if [ $exit_code -eq 0 ]
  then
    echo "::endgroup::"
  fi
}
datecheck
trap datecheck EXIT

# We've had problems in the past of shell scripts leaking fds into the sccache
# server (#48192) which causes Cargo to erroneously think that a build script
# hasn't finished yet. Try to solve that problem by starting a very long-lived
# sccache server at the start of the build, but no need to worry if this fails.
SCCACHE_IDLE_TIMEOUT=10800 sccache --start-server || true

# Our build may overwrite config.toml, so we remove it here
rm -f config.toml

$SRC/configure $RUST_CONFIGURE_ARGS

retry make prepare

# Display the CPU and memory information. This helps us know why the CI timing
# is fluctuating.
echo "::group::Display CPU and Memory information"
if isMacOS; then
    system_profiler SPHardwareDataType || true
    sysctl hw || true
    ncpus=$(sysctl -n hw.ncpu)
else
    cat /proc/cpuinfo || true
    cat /proc/meminfo || true
    ncpus=$(grep processor /proc/cpuinfo | wc -l)
fi
echo "::endgroup::"

if [ ! -z "$SCRIPT" ]; then
  echo "Executing ${SCRIPT}"
  sh -x -c "$SCRIPT"
else
  do_make() {
    echo "make -j $ncpus $1"
    make -j $ncpus $1
    local retval=$?
    return $retval
  }

  do_make "$RUST_CHECK_TARGET"
fi

if [ "$RUN_CHECK_WITH_PARALLEL_QUERIES" != "" ]; then
  rm -f config.toml
  $SRC/configure --set change-id=99999999 --set rust.parallel-compiler

  # Save the build metrics before we wipe the directory
  if [ "$HAS_METRICS" = 1 ]; then
    mv build/metrics.json .
  fi
  rm -rf build
  if [ "$HAS_METRICS" = 1 ]; then
    mkdir build
    mv metrics.json build
  fi

  CARGO_INCREMENTAL=0 ../x check
fi

echo "::group::sccache stats"
sccache --show-stats || true
echo "::endgroup::"
